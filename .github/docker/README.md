# Fork images

The `container images` Actions workflow publishes these linux/amd64 images on
pushes to `main`, or from **Run workflow**:

```sh
docker pull ghcr.io/jlgore/routr-one:latest
docker pull ghcr.io/jlgore/routr-connect:latest
```

For reproducible deployments, replace `latest` with `sha-<full commit SHA>`.
Image labels record the source repository and commit. The workflow runs the
unit, typecheck, lint, and Java checks before publishing, then checks module
loading and the Java runtime in the published images.

The fork Dockerfile installs the locked dependencies as local npm workspaces.
Every Routr module it runs comes from this checkout's compiled output; it does
not obtain the Connect implementation from npm. The all-in-one image also
contains Java artifacts built from this checkout and an offline Prisma CLI.

The all-in-one image uses the same service ports and configuration environment
variables as upstream. It includes PostgreSQL by default; set
`START_INTERNAL_DB=false` and `DATABASE_URL` to use an external database.
It does not include upstream's optional heplify packet-capture tool or sngrep.
The standalone Connect image needs `LOCATION_ADDR` and `API_ADDR` pointing to
the other services, as in the root Compose file.

GHCR initially creates packages as private. To allow anonymous pulls, open
each package's **Package settings**, choose **Change visibility**, and select
**Public**:

- https://github.com/users/jlgore/packages/container/routr-one/settings
- https://github.com/users/jlgore/packages/container/routr-connect/settings

Until then, authenticate with a token that can read packages:

```sh
gh auth token | docker login ghcr.io -u jlgore --password-stdin
```

To build locally, set `JAVA_HOME` to a JDK 17 installation, then run:

```sh
npm ci
npm run build
docker build -f .github/docker/Dockerfile --target connect -t routr-connect:local .
docker build -f .github/docker/Dockerfile --target one -t routr-one:local .
```
