const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const db = mysql.createConnection({
  host: process.env.HOST,
  user: process.env.USER,
  password: process.env.PASSWORD,
  database: process.env.DATABASE
});

db.connect((err) => {
  if (err) throw err;
  console.log("Connected to the database."); // use db to query pusher credentials
});

function verifyUser(email, callback) {
  const sql = `SELECT COUNT(*) AS count FROM Users WHERE email = ${db.escape(
    email
  )}`;
  db.query(sql, (err, result) => {
    if (err) throw err;
    callback(result[0].count > 0); // true if user exists
  });
}

function fetchEnvVariables(callback) {
  const sql = `SELECT APPID, APP_KEY, APP_SECRET, CLUSTER, USETLS FROM PUSHER;`;
  db.query(sql, (err, result) => {
    if (err) {
      callback(null, err); // Pass error to callback
    } else {
      callback(result[0], null); // Pass result and null for error
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
    // use db to find pusher credentials and initialise them here
    const sshUser = vmUsername;
    const sshHost = vmIpAddress;
    const sshPassword = vmPassword;

    await ssh.connect({
      host: sshHost,
      username: sshUser,
      password: sshPassword,
    });

    await ssh.execCommand("sudo apt-get install iproute2");
    console.log("iproute2 installed.");

    const repoUrl = "https://github.com/IS484-Dashify/prometheus-backend.git";
    const gitCloneCommand = `git clone ${repoUrl} ${uniqueFolderName}`;
    const npmInstallCommand = "npm install";
    const pm2StartCommand = "pm2 start server.js";
    const findPortCommand = `
      PORT=3000
      while ss -tulwn | grep -q ":$PORT "; do
        ((PORT++))
      done
      echo $PORT
    `;

    await ssh.execCommand(findPortCommand);
    const availablePort = portResult.stdout.trim();
    const folderName = repoUrl.match(/\/([^\/]+)\.git$/)[1];
    const dtNow = Date.now();
    const uniqueFolderName = `${folderName}-${dtNow}`;
    await ssh.execCommand(gitCloneCommand);
    console.log("Repository cloned.");

    const envContent = `appId=${envVars.appId}
    key=${envVars.key}
    secret=${envVars.secret}
    cluster=${envVars.cluster}
    useTLS=${envVars.useTLS}
    cid=${cid}
    PORT=${availablePort}
    repoUrl=${repoUrl}"`;

    await ssh.putFile(Buffer.from(envContent), `./${uniqueFolderName}/.env`);
    console.log(".env file uploaded.");

    await ssh.execCommand(npmInstallCommand, { cwd: uniqueFolderName });
    console.log("npm packages installed.");

    await ssh.execCommand(pm2StartCommand, { cwd: uniqueFolderName });
    console.log("Server started with PM2.");

    const insertSql = `INSERT INTO LOGS_PUSHER (CID, PORT) VALUES (${cid}, ${availablePort})`;
    db.query(insertSql, [cid, availablePort], (err, result) => {
      if (err) {
        console.error('Error inserting into LOGS_PUSHER:', err);
        return;
      }
      console.log('New environment setup logged in LOGS_PUSHER.');
    });


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

    fetchEnvVariables(async (envVars) => {
      await setupEnvironment(envVars, cid, vmUsername, vmIpAddress, vmPassword);
      res.send("Environment setup initiated successfully.");
    });
  });
});