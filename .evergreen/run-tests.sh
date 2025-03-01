#!/bin/bash
# set -o xtrace   # Write all commands first to stderr
set -o errexit  # Exit the script with error if any of the commands fail

# Supported/used environment variables:
#       AUTH                    Set to enable authentication. Defaults to "noauth"
#       SSL                     Set to enable SSL. Defaults to "nossl"
#       MONGODB_URI             Set the suggested connection MONGODB_URI (including credentials and topology info)
#       MARCH                   Machine Architecture. Defaults to lowercase uname -m
#       TEST_NPM_SCRIPT         Script to npm run. Defaults to "integration-coverage"
#       SKIP_DEPS               Skip installing dependencies
#       NO_EXIT                 Don't exit early from tests that leak resources
#       TEST_CSFLE              Set to enforce running csfle tests

AUTH=${AUTH:-noauth}
MONGODB_URI=${MONGODB_URI:-}
TEST_NPM_SCRIPT=${TEST_NPM_SCRIPT:-check:integration-coverage}
COMPRESSOR=${COMPRESSOR:-}
if [[ -z "${NO_EXIT}" ]]; then
  TEST_NPM_SCRIPT="$TEST_NPM_SCRIPT -- --exit"
fi

# ssl setup
SSL=${SSL:-nossl}
if [ "$SSL" != "nossl" ]; then
   export SSL_KEY_FILE="$DRIVERS_TOOLS/.evergreen/x509gen/client.pem"
   export SSL_CA_FILE="$DRIVERS_TOOLS/.evergreen/x509gen/ca.pem"
fi

# run tests
echo "Running $AUTH tests over $SSL, connecting to $MONGODB_URI"

if [[ -z "${SKIP_DEPS}" ]]; then
  source "${PROJECT_DIRECTORY}/.evergreen/install-dependencies.sh"
else
  source "${PROJECT_DIRECTORY}/.evergreen/init-nvm.sh"
fi

if [ "$COMPRESSOR" != "" ]; then
  if [[ "$MONGODB_URI" == *"?"* ]]; then
    export MONGODB_URI="${MONGODB_URI}&compressors=${COMPRESSOR}"
  else
    export MONGODB_URI="${MONGODB_URI}/?compressors=${COMPRESSOR}"
  fi
fi

# only run FLE tets on hosts we explicitly choose to test on
if [[ -z "${CLIENT_ENCRYPTION}" ]]; then
  unset AWS_ACCESS_KEY_ID;
  unset AWS_SECRET_ACCESS_KEY;
else
  pip install --upgrade boto3
  # Get access to the AWS temporary credentials:
  echo "adding temporary AWS credentials to environment"
  # CSFLE_AWS_TEMP_ACCESS_KEY_ID, CSFLE_AWS_TEMP_SECRET_ACCESS_KEY, CSFLE_AWS_TEMP_SESSION_TOKEN
  source "$DRIVERS_TOOLS"/.evergreen/csfle/set-temp-creds.sh
fi

npm install mongodb-client-encryption@">=2.2.0-alpha.2"
npm install @mongodb-js/zstd
npm install snappy

export AUTH=$AUTH
export SINGLE_MONGOS_LB_URI=${SINGLE_MONGOS_LB_URI}
export MULTI_MONGOS_LB_URI=${MULTI_MONGOS_LB_URI}
export MONGODB_API_VERSION=${MONGODB_API_VERSION}
export MONGODB_URI=${MONGODB_URI}
export LOAD_BALANCER=${LOAD_BALANCER}
export TEST_CSFLE=${TEST_CSFLE}
export COMPRESSOR=${COMPRESSOR}
# Do not add quotes, due to the way NO_EXIT is handled
npm run ${TEST_NPM_SCRIPT}
