import { createApi } from "./createApi.js";
import { config } from "./config.js";

const useApi = async () => {
  const client = await createApi(config);

  client.service("authentication").timeout = 60000;
  client.service("shape-storage-record").timeout = 60000;
  client.service("static-record-store").timeout = 60000;

  await client.authenticate({
    strategy: "local",
    email: config.email,
    password: config.password,
  });

  return client;
};

export { useApi };