import feathers from "@feathersjs/feathers";
import feathersRest from "@feathersjs/rest-client";
import feathersAuth from "@feathersjs/authentication-client";
import axios from "axios";
import SimpleStorage from "./simple-storage.js";
import path from "path";
import fs from "fs";
import FormData from "form-data";
import getStream from "get-stream";

const createApi = async (config) => {
  const storagePath = path.join(process.cwd(), "storage");
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }

  // Add delay to prevent concurrent access issues
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Initialize our simple storage
  const storage = new SimpleStorage({
    dir: storagePath,
    encoding: "utf8"
  });

  const client = feathers();
  const restClient = feathersRest(config.server);
  client.configure(restClient.axios(axios));
  client.configure(feathersAuth({ storage: storage }));

  client.set("stores", config.stores);
  client.set("folders", config.folders);

  client.upload = async (payload) => {
    const { accessToken } = await client.get("authentication");

    const stream = fs.createReadStream(payload.path, { autoClose: true });
    const buffer = await getStream.buffer(stream);

    const body = new FormData();
    body.append("uri", buffer, path.basename(payload.path));

    // Remove path from payload for meta
    const meta = { ...payload };
    delete meta.path;
    body.append("meta", JSON.stringify(meta));

    return await client.rest
      .post(`${config.server}/bucket-storage`, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "user-agent": "",
          ...body.getHeaders(),
        },
      })
      .then(({ data }) => data);
  };

  return client;
};

export { createApi };