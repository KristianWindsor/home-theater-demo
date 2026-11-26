# media/

Put your files here (this folder is mounted into the container at `/media`):

```
media/
  demos/    Dolby / DTS trailers, audiophile surround clips (video), or surround music demos (audio)
  movies/   films; MKV or MP4. One file per film, sub-folders are fine
  music/    any common audio format; one folder per album works nicely. A video with the same
            name as a song is its music video (scripts/fetch_music_video.py makes both from YouTube)
```

Blu-ray / UHD rips usually need one pass of `scripts/prepare_media.py` so their audio
plays in a browser (lossless; see the main README).

No media yet? `python3 scripts/make_test_media.py media` generates original test files.
