@echo off
chcp 65001
setlocal enabledelayedexpansion
set "YAML_FILE=config.yaml"
set "MODEL_PATH="
set "N_CTX="
set "NP="
set "PORT="
set "CONTEXT_SHIFT="
for /f "tokens=*" %%L in ('type "%YAML_FILE%" ^| findstr /V /B "#"') do (
	set "line=%%L"
	if not "!line!"=="" (
		for /f "tokens=1 delims=:" %%K in ("!line!") do set "key=%%K"
		for /f "tokens=1" %%K in ("!key!") do set "key=%%K"
		set "val=!line:*: =!"
		if "!key!"=="model_path" set "MODEL_PATH=!val!"
		if "!key!"=="n_ctx" set "N_CTX=!val!"
		if "!key!"=="np" set "NP=!val!"
		if "!key!"=="port" set "PORT=!val!"
		if "!key!"=="context_shift" (
			if "!val!"=="true" set "CONTEXT_SHIFT=--context-shift"
		)
	)
)
.\llama-server.exe -c %N_CTX% -m "%MODEL_PATH%" %CONTEXT_SHIFT% -np %NP% --port %PORT%
pause