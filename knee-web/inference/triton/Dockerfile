# Triton 25.10 uses CUDA 13.0, compatible with Cloud Run's current L4 driver line.
# Pin the tag; update only after repeating the model parity test.
ARG TRITON_BASE_IMAGE=nvcr.io/nvidia/tritonserver:25.10-py3
FROM ${TRITON_BASE_IMAGE}

WORKDIR /opt/knee-ai

# Install the same PyTorch family used by the offline runner into Triton's Python
# backend environment. Checkpoint weights are deliberately not copied into image.
RUN python3 -m pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cu124 \
      torch==2.5.1 torchvision==0.20.1 \
    && python3 -m pip install --no-cache-dir numpy==1.26.4 pydicom==3.0.1

COPY backend/ai/ /opt/knee-ai/backend/ai/
COPY inference/triton/model_repository/ /models/

ENV KNEE_AI_CODE_ROOT=/opt/knee-ai \
    KNEE_CHECKPOINT_PATH=/checkpoint/fold_00_best.zip

EXPOSE 8080
ENTRYPOINT ["/opt/tritonserver/bin/tritonserver"]
CMD ["--model-repository=/models", "--http-port=8080", "--grpc-port=0", "--metrics-port=8002"]
