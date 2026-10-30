# Manica

> run your own runners on your own machine

## Features

- installs as a custom github app
- register your machines (linux/macos) and set resource limits
- view realtime execution logs
- compatible with Github Checks

## Configuration reference

### Vest
- key: the api key you can generate from the control plane (vest)
- url: url of the `vest` this machine will talk to

### Sleeve
- name: the name this machine will be registered as (defaults to hostname)

## Install

- download the agent (sleeve) for your os
- create a `config.toml` file
