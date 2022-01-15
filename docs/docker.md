### Using Docker

If you want to avoid all the hassle of installing the dependencies, configuring nginx and so on you can try our docker image which makes things a bit simpler.

First make sure you have docker and docker composer installed, so please follow the install instructions for your OS/Distro:
- https://docs.docker.com/engine/install/debian/
- https://docs.docker.com/compose/install/

After that:
- Copy the config file called `docker-compose.config.example.yml` and name it `docker-compose.config.yml` with the values you want. Those that are left commented will use the default values.
- Copy either `host.fuwn.me.http.example.conf` or `host.fuwn.me.https.example.conf` and name it `host.fuwn.me.conf` for either HTTP or HTTPS
- - If using HTTPS make sure to put your certificates into the `ssl` folder and name them accordingly:
- - - `host.fuwn.me.crt` for the certificate
- - - `host.fuwn.me.key` for the certificate key

Once you are done run the following commands:

- `cd docker`
- `./hostess prod pull`
- `./hostess prod build`
- `./hostess prod up -d`

Congrats, your Hostess (chibisafe) instance is now running.
