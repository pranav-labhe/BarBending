# Python & Container Cheatsheet (`python/chit`)

Quick reference for running, testing, packaging offline wheels, and containerizing the **Offline Bar Bending Schedule (BBS) Generator**.

---

## 1. Environment Setup (Windows PowerShell / Linux)

```powershell
# Create and activate virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1       # Windows PowerShell
# source .venv/bin/activate      # Linux / macOS

# Install dependencies
pip install -r requirements.txt
```

## 2. True Air-Gapped / Offline Installation

Download wheels once on a connected PC, copy the folder via USB, and install completely offline:

```powershell
# Download wheels
mkdir wheels
pip download -r requirements.txt -d .\wheels

# Install offline (zero internet)
pip install --no-index --find-links=.\wheels -r requirements.txt
```

## 3. Start the Web App

```powershell
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

- Web UI: `http://127.0.0.1:8000`
- Health Check: `http://127.0.0.1:8000/api/health`
- API Docs: `http://127.0.0.1:8000/api/docs`

## 4. Verification & Testing

```powershell
python -m compileall -q app tests
pytest -v
```

## 5. Containerfile (Docker / Podman)

```powershell
# Build image from Containerfile
docker build -f Containerfile -t bbs-offline:latest .

# Run locally
docker run --rm -p 8000:8000 bbs-offline:latest

# Export / import tar for offline machines
docker save -o bbs-offline.tar bbs-offline:latest
docker load -i bbs-offline.tar
```
*(Works identically with `podman` instead of `docker`.)*
