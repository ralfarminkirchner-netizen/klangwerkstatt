FROM python:3.11-slim
WORKDIR /app
COPY requirements-no-audio.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
# force rebuild Sun Jul 26 14:02:22 CEST 2026
