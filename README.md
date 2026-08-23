# ASCAT Ocean Wind Atlas

A static GitHub Pages viewer for the latest OSI-104 ASCAT wind observations. The browser never receives EUMDAC credentials. A scheduled GitHub Action queries the EUMETSAT Data Store, keeps the newest observation in each 0.25-degree cell from the last 24 hours, and publishes `data/latest.json` with the viewer.

## GitHub setup

1. Push this repository to GitHub.
2. Add repository secrets named `EUMDAC_CONSUMER_KEY` and `EUMDAC_CONSUMER_SECRET`.
3. In Settings > Pages, choose **GitHub Actions** as the source.
4. Run **Update ASCAT data and deploy Pages** once from the Actions tab. It then runs hourly.

The viewer supports global data, drag-box zoom, zoom out, point inspection, passive drift playback, and GIF export for the current view. The GIF export uses the browser and does not require a server.

## Local data build

```powershell
.\.venv\Scripts\python.exe build_latest_ocean_dataset.py
```

For local authentication, use `C:\Users\<user>\.eumdac\credentials` with one line in the form `consumer_key,consumer_secret`, or set the two EUMDAC environment variables.

The public data product is `EO:EUM:DAT:METOP:OSI-104`.
