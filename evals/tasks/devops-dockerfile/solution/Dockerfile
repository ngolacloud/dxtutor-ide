FROM python:3.12-slim
WORKDIR /app
RUN useradd --create-home --uid 10001 app
COPY --chown=app:app . .
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" || exit 1
CMD ["python", "app.py"]
