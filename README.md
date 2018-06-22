# Trambar-cli

Trambar-cli is a utility for installing and updating a [Trambar](https://github.com/chung-leong/trambar/)
server.

## Installation

```sh
sudo npm install -g trambar
```

## Usage

### Installing Trambar

Please following the [instructions here](https://github.com/chung-leong/trambar/blob/master/docs/getting-started.md).

### Starting Trambar

```sh
sudo trambar start
```

### Stoping Trambar

```sh
sudo trambar stop
```

### Restarting Trambar

```sh
sudo trambar restart
```

### Updating Trambar

To pull the latest images of Trambar from [Docker Hub](https://hub.docker.com/u/trambar/dashboard/):

```sh
sudo trambar update
```

### Uninstalling Trambar

To remove Trambar's Docker images from a system as well as its configuration
files:

```sh
sudo trambar uninstall
```

You will need to manually remove the database and any media files (probably
in `/srv/trambar`).

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details
