#!/bin/bash

CONFIG_FILE="${1:-config.yaml}"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: $CONFIG_FILE not found."
    exit 1
fi

# 用 awk 解析简单的 key: value 对
eval $(awk '
/^[[:space:]]*#/ { next }
/^[[:space:]]*[a-zA-Z_][a-zA-Z0-9_]*:[[:space:]]*/ {
    key = $1
    gsub(/[[:space:]]*:/, "", key)
    value = $0
    sub(/^[^:]*:[[:space:]]*/, "", value)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
    if (value == "true" || value == "false") {
        value = tolower(value)
    }
    printf("%s=\"%s\"\n", key, value)
}' "$CONFIG_FILE")

# 检查必要字段
if [ -z "$model_path" ]; then
    echo "Error: model_path not found in config."
    exit 1
fi
if [ -z "$n_ctx" ]; then
    echo "Error: n_ctx not found."
    exit 1
fi
if [ -z "$port" ]; then
    echo "Error: port not found."
    exit 1
fi
if [ -z "$np" ]; then
    np=1
fi

# 构建命令行参数
cmd_args=(-c "$n_ctx" -m "$model_path" -np "$np" --port "$port")
if [ "$context_shift" = "true" ]; then
    cmd_args+=(--context-shift)
fi

# 运行 llama-server
echo "Running: llama-server ${cmd_args[@]}"
exec llama-server "${cmd_args[@]}"
