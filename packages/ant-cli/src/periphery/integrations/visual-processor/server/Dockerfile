FROM python:3.10-slim

WORKDIR /app

COPY packages/ant-cli/src/periphery/integrations/visual-processor/server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY packages/ant-cli/src/periphery/integrations/visual-processor/server/config.py \
     packages/ant-cli/src/periphery/integrations/visual-processor/server/processor.py \
     packages/ant-cli/src/periphery/integrations/visual-processor/server/app.py \
     ./

EXPOSE 4103

ENV UVICORN_WORKERS=1

CMD ["sh", "-c", "uvicorn app:create_app --factory --host 0.0.0.0 --port 4103 --no-access-log --workers ${UVICORN_WORKERS}"]
