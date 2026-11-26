'use strict';
// Movies kept in S3 (MEDIA_BUCKET) instead of MEDIA_DIR/movies. The browser streams them from CloudFront
// (MEDIA_CDN_URL) through short-lived signed links, so the bytes never touch this server or its disk;
// ffprobe and the thumbnailer read them straight from S3 with presigned links (a few MB each).
// Zero dependencies: AWS SigV4 and CloudFront URL signing are done with node:crypto.
const crypto = require('crypto');
const config = require('./config');

const enabled = () => !!config.bucket;

/** Movies are the only category kept remotely: music needs local files for the analyzer, demos are small. */
const isRemote = (category) => enabled() && category === 'movies';

// ---------------------------------------------------------------- what the last listing saw
const known = new Map(); // key -> { size, mtime }

function has(key) {
  return known.has(key);
}

// ---------------------------------------------------------------- SigV4 (S3 presigned GETs)
function rfc3986(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Path of an object key in a URL: each segment percent-encoded, slashes kept. */
const keyPath = (key) => `/${key.split('/').map(rfc3986).join('/')}`;

function endpoint() {
  // Bucket names with dots break virtual-hosted TLS (*.s3... wildcard), so they use path-style URLs
  const pathStyle = config.bucket.includes('.');
  return {
    host: pathStyle ? `s3.${config.bucketRegion}.amazonaws.com` : `${config.bucket}.s3.${config.bucketRegion}.amazonaws.com`,
    base: pathStyle ? `/${rfc3986(config.bucket)}` : '',
  };
}

function credentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error('MEDIA_BUCKET needs AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
  return { accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN };
}

const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** A presigned S3 GET for `urlPath` (from keyPath(), or '/' for the bucket itself). */
function presign(urlPath, params = {}, expiresSeconds = 3600) {
  const { accessKeyId, secretAccessKey, sessionToken } = credentials();
  const { host, base } = endpoint();
  const region = config.bucketRegion;
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); // 20261126T013700Z
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const q = {
    ...params,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(604800, Math.max(1, Math.round(expiresSeconds)))),
    'X-Amz-SignedHeaders': 'host',
  };
  if (sessionToken) q['X-Amz-Security-Token'] = sessionToken;
  const query = Object.keys(q).sort().map((k) => `${rfc3986(k)}=${rfc3986(q[k])}`).join('&');
  const uri = base + urlPath;
  const canonical = ['GET', uri, query, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  let k = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, 's3', 'aws4_request']) k = hmac(k, part);
  const signature = crypto.createHmac('sha256', k).update(toSign).digest('hex');
  return `https://${host}${uri}?${query}&X-Amz-Signature=${signature}`;
}

// ---------------------------------------------------------------- listing
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unxml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return XML_ENTITIES[e] !== undefined ? XML_ENTITIES[e] : m;
  });
}
function tag(xml, name) {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? unxml(m[1]) : null;
}

/** Every object under `prefix`: [{ key, size, mtime }]. Remembers them for has(). */
async function list(prefix) {
  const out = [];
  let token = null;
  do {
    const params = { 'list-type': '2', prefix };
    if (token) params['continuation-token'] = token;
    const res = await fetch(presign('/', params, 300), { signal: AbortSignal.timeout(20000) });
    const xml = await res.text();
    if (!res.ok) throw new Error(`S3 list s3://${config.bucket}/${prefix}: HTTP ${res.status} ${tag(xml, 'Code') || ''}`.trim());
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = tag(m[1], 'Key');
      if (!key || key.endsWith('/')) continue; // "folder" placeholder objects
      out.push({ key, size: Number(tag(m[1], 'Size')), mtime: Date.parse(tag(m[1], 'LastModified')) });
    }
    token = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : null;
  } while (token);
  for (const k of [...known.keys()]) if (k.startsWith(prefix)) known.delete(k);
  for (const o of out) known.set(o.key, { size: o.size, mtime: o.mtime });
  return out;
}

// ---------------------------------------------------------------- links
/** For ffprobe/ffmpeg on this server: straight from S3 (same region as the server, so no transfer cost). */
function serverUrl(key) {
  return presign(keyPath(key), {}, 3600);
}

const cdnEnabled = () => !!(config.cdnUrl && config.cdnKeyPairId && config.cdnPrivateKey);

let privateKey = null;
function cdnKey() {
  if (!privateKey) privateKey = crypto.createPrivateKey(config.cdnPrivateKey);
  return privateKey;
}

/** CloudFront signed URL (canned policy) for `url`, valid until `expires` (epoch seconds). */
function cdnSign(url, expires) {
  const policy = JSON.stringify({ Statement: [{ Resource: url, Condition: { DateLessThan: { 'AWS:EpochTime': expires } } }] });
  const signature = crypto.sign('RSA-SHA1', Buffer.from(policy), cdnKey()).toString('base64')
    .replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
  return `${url}?Expires=${expires}&Signature=${signature}&Key-Pair-Id=${config.cdnKeyPairId}`;
}

/**
 * For the browser: a link that stays valid for MEDIA_LINK_HOURS (a film plus a long pause).
 * The expiry is rounded up to the hour so the same link comes back for an hour and the browser cache can use it.
 */
function viewerUrl(key) {
  const ttl = config.linkHours * 3600;
  const expires = Math.ceil((Date.now() / 1000 + ttl) / 3600) * 3600;
  if (cdnEnabled()) return cdnSign(config.cdnUrl + keyPath(key), expires);
  return presign(keyPath(key), {}, expires - Date.now() / 1000);
}

/** The origin the browser loads media from, for the Content-Security-Policy. */
function viewerOrigin() {
  if (!enabled()) return null;
  if (cdnEnabled()) return new URL(config.cdnUrl).origin;
  return `https://${endpoint().host}`;
}

module.exports = { enabled, isRemote, has, list, serverUrl, viewerUrl, viewerOrigin, cdnEnabled };
