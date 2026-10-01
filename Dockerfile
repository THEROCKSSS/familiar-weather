FROM python:3.12-slim
WORKDIR /app
COPY server.py index.html styles.css app.js ./
EXPOSE 8123
CMD ["python", "server.py", "--port", "8123"]
