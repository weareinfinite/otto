import * as RaspiLeds from "../lib/raspi/leds";
import { IODriverModule } from "../types";

export const id = "leds";

const colorForRecognizing = [0, 255, 0];
const colorForOutput = [255, 0, 0];
const colorForThinking = [255, 255, 0];

export const startInput = (io: IODriverModule) => {
  RaspiLeds.off();

  io.emitter.on("input", () => {
    RaspiLeds.setColor(colorForThinking);
  });

  io.emitter.on("output", () => {
    RaspiLeds.setColor(colorForOutput);
  });

  io.emitter.on("thinking", () => {
    RaspiLeds.setColor(colorForThinking);
  });

  io.emitter.on("recognizing", () => {
    RaspiLeds.setColor(colorForRecognizing);
  });

  io.emitter.on("notrecognizing", () => {
    RaspiLeds.off();
  });

  io.emitter.on("stopped", () => {
    RaspiLeds.off();
  });
};