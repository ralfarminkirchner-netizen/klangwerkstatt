FROM python:3.11-slim

WORKDIR /app

# System deps für librosa/soundfile
RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
        libsndfile1 \
        libsndfile1-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Test ob librosa import funktioniert
RUN python -c "import librosa; print('librosa OK')"

COPY . .

EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
