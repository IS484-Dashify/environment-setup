const fs = require("fs");
const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const { NodeSSH } = require("node-ssh");
require("dotenv").config();

const ssh = new NodeSSH();
const app = express();
app.use(bodyParser.json());

const db = mysql.createConnection({
  host: process.env.HOST,
  user: process.env.DB_USER,
  password: process.env.PASSWORD,
  database: process.env.DATABASE,
});

db.connect((err) => {
  if (err) throw err;
  console.log("Connected to the database.");
});

function verifyUser(email, callback) {
  const sql = `SELECT COUNT(*) AS count FROM USERS WHERE email = ${db.escape(
    email
  )}`;
  db.query(sql, (err, result) => {
    if (err) throw err;
    callback(result[0].count > 0);
  });
}

function verifyNoDuplicate(cid, callback) {
  const sql = `SELECT COUNT(*) AS count FROM LOGS_PUSHER WHERE CID = ${db.escape(
    cid
  )}`;
  db.query(sql, (err, result) => {
    if (err) throw err;
    callback(result[0].count > 0);
  });
}

function fetchEnvVariables(callback) {
  const sql = `SELECT APPID, APP_KEY, APP_SECRET, CLUSTER, USETLS FROM PUSHER;`;
  db.query(sql, (err, result) => {
    if (err) {
      callback(null, err);
    } else {
      callback(result[0], null);
    }
  });
}

async function setupEnvironment(
  envVars,
  cid,
  vmUsername,
  vmIpAddress,
  vmPassword
) {
  try {
    const sshUser = vmUsername;
    const sshHost = vmIpAddress;
    const sshPassword = vmPassword;

    await ssh.connect({
      host: sshHost,
      username: sshUser,
      password: sshPassword,
    });

    console.log(envVars);
    console.log(envVars.APPID);
    console.log(envVars.APP_KEY);

    await ssh.execCommand("sudo apt-get install iproute2");
    console.log("iproute2 installed.");

    const repoUrl = "https://github.com/IS484-Dashify/prometheus-backend.git";

    const npmInstallCommand = "npm install";
    const pm2StartCommand = "pm2 start server.js";
    const findPortCommand = `
      PORT=3000
      while ss -tulwn | grep -q ":$PORT "; do
        ((PORT++))
      done
      echo $PORT
    `;

    const portResult = await ssh.execCommand(findPortCommand);
    const availablePort = portResult.stdout.trim();
    const folderName = repoUrl.match(/\/([^\/]+)\.git$/)[1];
    const dtNow = Date.now();
    const uniqueFolderName = `${folderName}-${dtNow}`;
    const gitCloneCommand = `git clone ${repoUrl} ${uniqueFolderName}`;
    await ssh.execCommand(gitCloneCommand);
    console.log("Repository cloned.");
    useTLS = envVars.USETLS === 1 ? true : false;

    const envContent = `appId=${envVars.APPID}
    key=${envVars.APP_KEY}
    secret=${envVars.APP_SECRET}
    cluster=${envVars.CLUSTER}
    useTLS=${useTLS}
    cid=${cid}
    PORT=${availablePort}
    repoUrl="${repoUrl}"`;

    const tempEnvPath = path.join(__dirname, "tempEnvFile.env");
    fs.writeFileSync(tempEnvPath, envContent);
    console.log("Local .env file created.");

    console.log("debug1");
    await ssh.putFile(tempEnvPath, `./${uniqueFolderName}/.env`);
    console.log("debug2");
    console.log(".env file uploaded.");
    console.log("debug3");

    await ssh.execCommand(npmInstallCommand, { cwd: uniqueFolderName });
    console.log("npm packages installed.");

    await ssh.execCommand(pm2StartCommand, { cwd: uniqueFolderName });
    console.log("Server started with PM2.");

    const insertSql = `INSERT INTO LOGS_PUSHER (CID, PORT) VALUES (${cid}, ${availablePort})`;
    db.query(insertSql, [cid, availablePort], (err, result) => {
      if (err) {
        console.error("Error inserting into LOGS_PUSHER:", err);
        return;
      }
      console.log("New environment setup logged in LOGS_PUSHER.");
    });

    fs.unlinkSync(tempEnvPath);
    console.log("Local .env file removed.");
  } catch (error) {
    console.error(error);
  } finally {
    ssh.dispose();
  }
}

app.post("/setup-environment", (req, res) => {
  const { cid, email, vmUsername, vmIpAddress, vmPassword } = req.body;

  verifyUser(email, (isValidUser) => {
    if (!isValidUser) {
      return res.status(401).send("Unauthorized: Invalid CID or email");
    }

    // Next, verify that there is no duplicate CID in LOGS_PUSHER
    verifyNoDuplicate(cid, (isDuplicate) => {
      if (isDuplicate) {
        return res
          .status(400)
          .send("Error: CID already exists in LOGS_PUSHER.");
      }

      fetchEnvVariables(async (envVars) => {
        try {
          await setupEnvironment(
            envVars,
            cid,
            vmUsername,
            vmIpAddress,
            vmPassword
          );
          res.send("Environment setup initiated successfully.");
        } catch (error) {
          console.error("Setup environment failed:", error);
          res.status(500).send("Failed to set up environment.");
        }
      });
    });
  });
});

const port = process.env.PORT || 3000;

server = app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
