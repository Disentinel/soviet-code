# Деплой Conductor на сервер

## Файлы

```
/opt/soviet-code/          ← клон репозитория (git clone + npm install + npm run build:conductor)
/etc/soviet-code/env       ← секреты (см. ниже)
/etc/systemd/system/conductor.service  ← копия conductor/conductor.service
```

## Создать env-файл

```bash
sudo mkdir -p /etc/soviet-code
sudo tee /etc/soviet-code/env <<EOF
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=...
EOF
sudo chmod 600 /etc/soviet-code/env
```

## Запустить сервис

```bash
sudo cp /opt/soviet-code/conductor/conductor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now conductor
sudo journalctl -u conductor -f
```
