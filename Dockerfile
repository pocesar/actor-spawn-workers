FROM apify/actor-node

# Second, copy just package.json and package-lock.json since they are the only files
# that affect NPM install in the next step
COPY package*.json ./

# Install NPM packages, skip optional and development dependencies to keep the
# image small. Avoid logging too much and print the dependency tree for debugging
RUN npm --quiet set progress=false \
 && npm install --only=prod --no-optional \
 && echo "Installed NPM packages:" \
 && npm list \
 && echo "Node.js version:" \
 && node --version \
 && echo "NPM version:" \
 && npm --version

ENV npm_config_loglevel=silent
COPY . ./
