# ==============================================================================
# Dexter Write — Serverless LaTeX Compiler (AWS Lambda & Local Docker)
# ==============================================================================
FROM public.ecr.aws/lambda/nodejs:20

# Install minimal tools to download tectonic
RUN dnf install -y tar gzip ca-certificates fontconfig && dnf clean all

# Download and install precompiled static Tectonic binary (Rust-based XeTeX compiler)
ARG TECTONIC_VERSION=0.15.0
RUN curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin \
    && chmod +x /usr/local/bin/tectonic

# Set up pre-warmed cache directory for standard packages
ENV TECTONIC_CACHE_DIR=/var/task/.cache/Tectonic
RUN mkdir -p /var/task/.cache/Tectonic

# Pre-warm common ATS Resume & Academic packages into image cache during build
# This ensures zero network latency and 100% offline capability inside Lambda
RUN printf '\\documentclass[11pt,a4paper]{article}\n\\usepackage{geometry,hyperref,xcolor,titlesec,enumitem,amsmath,amssymb,latexsym}\n\\begin{document}\nHello World\n\\end{document}\n' > /tmp/warmup.tex \
    && tectonic --outdir /tmp /tmp/warmup.tex \
    && rm -rf /tmp/warmup.*

# Copy handler code
COPY handler.mjs package.json ${LAMBDA_TASK_ROOT}/

# Set Lambda handler (handler.mjs -> export const handler)
CMD [ "handler.handler" ]
