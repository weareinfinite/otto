import fs from "fs";
import request from "request";
import TelegramBot from "node-telegram-bot-api";
import Events from "events";
import bodyParser from "body-parser";
import config from "../config";
import * as Server from "../stdlib/server";
import * as IOManager from "../stdlib/iomanager";
import * as SR from "../interfaces/sr";
import * as TTS from "../interfaces/tts";
import * as Play from "../lib/play";
import * as Proc from "../lib/proc";
import { mimicHumanMessage, getAiNameRegex, uuid, rand } from "../helpers";
import { tmpDir } from "../paths";

const _config = config().telegram;
const TAG = "IO.Telegram";
export const emitter = new Events.EventEmitter();

const bot = new TelegramBot(_config.token, _config.options);

let started = false;
const callbackQuery = {};

export const id = "telegram";

/**
 * Handle a voice input by recognizing the text
 *
 *
 */
async function handleInputVoice(session: any, e) {
  return new Promise(async resolve => {
    const fileLink = await bot.getFileLink(e.voice.file_id);
    const voiceFile = `${tmpDir}/${uuid()}.ogg`;

    request(fileLink)
      .pipe(fs.createWriteStream(voiceFile))
      .on("close", async () => {
        await Proc.spawn("opusdec", [voiceFile, `${voiceFile}.wav`, "--rate", SR.SAMPLE_RATE]);
        const text = await SR.recognizeFile(`${voiceFile}.wav`, session.getTranslateFrom(), false);
        resolve(text);
      });
  });
}

/**
 * Remove any XML tag
 *
 */
function cleanOutputText(text: string) {
  return text.replace(/<[^>]+>/g, "");
}

/**
 * Send a message to the user
 *
 *
 *
 */
async function sendMessage(
  chatId: string,
  text: string,
  opt: any = {
    parse_mode: "html",
  },
) {
  await bot.sendChatAction(chatId, "typing");
  return bot.sendMessage(chatId, cleanOutputText(text), opt);
}

/**
 * Send a voice message to the user
 *
 *
 *
 *
 */
async function sendVoiceMessage(chatId: string, text: string, language: string, botOpt: any = {}) {
  const sentences = mimicHumanMessage(text);
  await bot.sendChatAction(chatId, "record_audio");

  for (const sentence of sentences) {
    const audioFile = await TTS.getAudioFile(sentence, language, config().tts.gender);
    const voiceFile = await Play.playVoiceToTempFile(audioFile);
    await bot.sendVoice(chatId, voiceFile, botOpt);
  }
}

/**
 * Start the polling/webhook cycle
 */
export function start() {
  if (started) return;
  started = true;

  // We could attach the webhook to the Router API or via polling
  if (_config.useRouter && config().serverMode) {
    bot.setWebHook(`${config().server.domain}/io/telegram/bot${_config.token}`);
    Server.routerIO.use("/telegram", bodyParser.json(), (req, res) => {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });
    console.info(TAG, "started", _config);
  } else {
    console.info(TAG, "started via polling", _config);
  }
}

/**
 * Output an object to the user
 *
 *
 */
export async function output(f, session) {
  let processed = false;

  // Inform observers
  emitter.emit("output", {
    session,
    fulfillment: f,
  });

  // This is the Telegram Chat ID used to respond to the user
  const chatId = session.ioData.id;
  const language = f.payload.language || session.getTranslateTo();

  let botOpt = {};

  // If we have replies, set the bot opt to reflect the keyboard
  if (f.payload.replies != null) {
    botOpt = {
      reply_markup: {
        resize_keyboard: true,
        one_time_keyboard: true,
        keyboard: [
          f.payload.replies.map(r => {
            if (typeof r === "string") return r;
            return r.text;
          }),
        ],
      },
    };
  }

  // Process a Text Object
  try {
    if (f.text) {
      await sendMessage(chatId, f.text, botOpt);

      if (session.pipe.nextWithVoice) {
        session.savePipe({
          nextWithVoice: false,
        });
        await sendVoiceMessage(chatId, f.text, language, botOpt);
      }
      if (f.payload.includeVoice) {
        await sendVoiceMessage(chatId, f.text, language, botOpt);
      }
      processed = true;
    }
  } catch (err) {
    console.error(TAG, err);
  }

  // Process a URL Object
  try {
    if (f.payload.url) {
      await bot.sendMessage(chatId, f.payload.url, botOpt);
      processed = true;
    }
  } catch (err) {
    console.error(TAG, err);
  }

  // Process a Music object
  try {
    if (f.payload.music) {
      if (f.payload.music.spotify) {
        if (f.payload.music.spotify.track) {
          await sendMessage(chatId, f.payload.music.spotify.track.external_urls.spotify, botOpt);
        } else if (f.payload.music.spotify.tracks) {
          await sendMessage(
            chatId,
            f.payload.music.spotify.tracks.map(e => e.external_urls.spotify).join("\n"),
            botOpt,
          );
        } else if (f.payload.music.spotify.album) {
          await sendMessage(chatId, f.payload.music.spotify.album.external_urls.spotify, botOpt);
        } else if (f.payload.music.spotify.artist) {
          await sendMessage(chatId, f.payload.music.spotify.artist.external_urls.spotify, botOpt);
        } else if (f.payload.music.spotify.playlist) {
          await sendMessage(chatId, f.payload.music.spotify.playlist.external_urls.spotify, botOpt);
        }
      } else if (f.payload.music.uri) {
        await sendMessage(chatId, f.payload.music.uri, botOpt);
      }
      processed = true;
    }
  } catch (err) {
    console.error(TAG, err);
  }

  // Process a Video object
  try {
    if (f.payload.video) {
      if (f.payload.video.uri) {
        await bot.sendChatAction(chatId, "upload_video");
        await bot.sendVideo(chatId, f.payload.video.uri, botOpt);
      } else if (f.payload.video.youtube) {
        await bot.sendMessage(chatId, `https://www.youtube.com/watch?v=${f.payload.video.youtube.id}`, botOpt);
      }
      processed = true;
    }
  } catch (err) {
    console.error(TAG, err);
  }

  // Process an Image Object
  try {
    if (f.payload.image) {
      if (f.payload.image.uri) {
        await bot.sendChatAction(chatId, "upload_photo");
        await bot.sendPhoto(chatId, f.payload.image.uri, botOpt);
      }
      processed = true;
    }
  } catch (err) {
    console.error(TAG, err);
  }

  // Process an Audio Object
  try {
    if (f.payload.audio) {
      if (f.payload.audio.uri) {
        await bot.sendChatAction(chatId, "upload_audio");
        await bot.sendAudio(chatId, f.payload.audio.uri, botOpt);
      }
      processed = true;
    }
  } catch (err) {
    console.error(TAG, err);
  }

  // Process a Voice Object
  try {
    if (f.payload.voice) {
      if (f.payload.voice.uri) {
        await bot.sendChatAction(chatId, "upload_audio");
        const voiceFile = await Play.playVoiceToTempFile(f.payload.voice.uri);
        await bot.sendVoice(chatId, voiceFile, botOpt);
      }
      processed = true;
    }
  } catch (err) {
    console.error(TAG, err);
  }

  // Process a Document Object
  try {
    if (f.payload.document) {
      if (f.payload.document.uri) {
        await bot.sendChatAction(chatId, "upload_document");
        await bot.sendDocument(chatId, f.payload.document.uri, botOpt);
      }
      processed = true;
    }
  } catch (err) {
    console.error(TAG, err);
  }

  try {
    if (f.payload.error?.message) {
      await sendMessage(chatId, f.payload.error.message, botOpt);
      processed = true;
    }
  } catch (err) {
    console.error(TAG, err);
  }

  // ---- Telegram specific Objects ----

  // Process a Game Object
  try {
    if (f.payload.game) {
      callbackQuery[chatId] = callbackQuery[chatId] || {};
      callbackQuery[chatId][f.payload.game.id] = f.payload.game;
      await bot.sendGame(chatId, f.payload.game.id);
      processed = true;
    }
  } catch (err) {
    console.error(TAG, err);
  }

  // Process a Sticker Object
  try {
    if (f.payload.sticker) {
      await bot.sendSticker(chatId, rand(f.payload.sticker), botOpt);
      processed = true;
    }
  } catch (err) {
    console.error(TAG, err);
  }

  return processed;
}

bot.on("webhook_error", err => {
  console.error(TAG, "webhook error", err);
});

bot.on("message", async e => {
  console.info(TAG, "input");
  console.dir(e, {
    depth: 2,
  });

  const sessionId = e.chat.id.toString();
  const chatIsGroup = e.chat.type === "group";

  let alias;
  switch (e.chat.type) {
    case "private":
      alias = `${e.chat.first_name} ${e.chat.last_name}`;
      break;
    default:
      alias = e.chat.title;
      break;
  }

  // Register the session
  const session = await IOManager.registerSession("telegram", sessionId, e.chat, alias);

  // Process a Text object
  if (e.text) {
    // If we are in a group, only listen for activators
    if (chatIsGroup && !getAiNameRegex().test(e.text)) {
      console.debug(TAG, "skipping input for missing activator", e.text);
      return false;
    }

    emitter.emit("input", {
      session,
      params: {
        text: e.text,
      },
    });
    return true;
  }

  // Process a Voice object
  if (e.voice) {
    try {
      const text = await handleInputVoice(session, e);

      // If we are in a group, only listen for activators
      if (chatIsGroup && !getAiNameRegex().test(e.text)) {
        console.debug(TAG, "skipping input for missing activator", e.text);
        return false;
      }

      // User sent a voice note, respond with a voice note :)
      session.savePipe({
        nextWithVoice: true,
      });
      emitter.emit("input", {
        session,
        params: {
          text,
        },
      });
    } catch (err) {
      if (chatIsGroup === false) {
        return false;
      }
      if (err.unrecognized) {
        return emitter.emit("input", {
          session,
          params: {
            event: "io_SR_unrecognized",
          },
        });
      }
      return emitter.emit("input", {
        session,
        error: err,
      });
    }

    return true;
  }

  // Process a Photo Object
  if (e.photo) {
    const photoLink = bot.getFileLink(e.photo[e.photo.length - 1].file_id);
    if (chatIsGroup) return false;

    emitter.emit("input", {
      session,
      params: {
        image: {
          uri: photoLink,
        },
      },
    });

    return true;
  }

  emitter.emit("input", {
    session,
    error: {
      unkownInputType: true,
    },
  });
  return true;
});