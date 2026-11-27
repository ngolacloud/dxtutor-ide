/* Textos das imagens anexadas à conversa do Co-Dev (H5c — texto novo, sem par no motor de tradução): en + ptAO. */
import type { Messages } from "../../../app/i18n";

export const CODEV_IMAGE_MESSAGES = {
  en: {
    imageAttached: "{name} attached: it goes to the model with your message.",
    imageTooBig: "{name} has {size}: at most 3.75 MB per image — downscale it first.",
    imageKind: "{name}: only PNG, JPEG, GIF and WebP images go to the model.",
    imageLimit: "At most 8 images per message.",
    imagesNeedAgent: "The images go only to the Co-Dev agent (desktop, with a folder open): the message went without them.",
    imagesNotWithCommand: "A /command takes no images: they stay attached for your next message.",
    imagesWait: "The Co-Dev is still working: send the images when it finishes (they stay attached).",
  },
  ptAO: {
    imageAttached: "{name} anexada: segue para o modelo com a tua mensagem.",
    imageTooBig: "{name} tem {size}: no máximo 3,75 MB por imagem — reduz primeiro.",
    imageKind: "{name}: só imagens PNG, JPEG, GIF e WebP seguem para o modelo.",
    imageLimit: "No máximo 8 imagens por mensagem.",
    imagesNeedAgent: "As imagens só seguem para o agente Co-Dev (desktop, com uma pasta aberta): a mensagem foi sem elas.",
    imagesNotWithCommand: "Um /comando não leva imagens: ficam anexadas para a próxima mensagem.",
    imagesWait: "O Co-Dev ainda está a trabalhar: envia as imagens quando acabar (ficam anexadas).",
  },
} satisfies Messages<string>;
