#!/bin/bash

SERVICE=rambo
WORKING_DIR=/home/rambo/rambo-bot
LINK=/lib/systemd/system/rambo.service

if [ ! -L "$LINK" ]; then
  # Link the service file into place
  sudo ln -s "$WORKING_DIR/rambo.service" "$LINK"

  # Reload the daemon so it knows about the new file
  sudo systemctl daemon-reload
else
  # Stop current service if exists
  sudo systemctl stop "$SERVICE.service"
fi

# Reload daemon
sudo systemctl daemon-reload

# Enable our new service
sudo systemctl enable $SERVICE

# Start the service
sudo systemctl start $SERVICE
