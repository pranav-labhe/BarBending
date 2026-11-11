---
name: python-chit
description: Quick Python, FastAPI, pytest, offline wheelhouse, and Containerfile runbook/cheatsheet for the Offline Bar Bending Schedule (BBS) web app. Triggered via /python-chit or when setting up, running, testing, or containerizing this workspace.
---

# Python & Container Cheatsheet (`/python-chit`)

## 1. Local Setup (Windows PowerShell)
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 2. Create Air-Gapped / Offline Wheelhouse (Zero-Internet Install)
On a connected machine:
```powershell
mkdir wheels
pip download -r requirements.txt -d .\wheels
```
On the offline target PC:
```powershell
pip install --no-index --find-links=.\wheels -r requirements.txt
```

## 3. Run the Offline Web App
```powershell
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
Open: `http://127.0.0.1:8000`

## 4. Run Tests & Syntax Checks
```powershell
python -m compileall -q app tests
pytest -v
```

## 5. Build & Run Container (`Containerfile`)
Using Docker or Podman:
```powershell
docker build -f Containerfile -t bbs-offline:latest .
docker run --rm -p 8000:8000 --network none bbs-offline:latest
```
*(Or replace `docker` with `podman`. Note `--network none` or LAN-only `-p 127.0.0.1:8000:8000` proves 100% offline operation.)*

## 6. Export/Load Container Image for Offline Server Transfer
```powershell
docker save -o bbs-offline.tar bbs-offline:latest
docker load -i bbs-offline.tar
```
