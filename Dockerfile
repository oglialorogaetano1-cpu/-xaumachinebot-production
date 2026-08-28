FROM mcr.microsoft.com/playwright/python:v1.55.0-noble
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt
COPY puprime_worker.py .
CMD ["python3", "/app/puprime_worker.py"]
