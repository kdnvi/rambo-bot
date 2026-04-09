import { Events } from 'discord.js';
import { pickLine } from '../utils/flavor.js';

const REPLY_CHANCE = 0.5;

export const name = Events.MessageCreate;
export async function execute(message) {
  if (message.author.bot) return;

  const botId = message.client.user.id;
  const isMentioned = message.mentions.has(botId);
  const isReply = !!message.reference;

  if (!isMentioned && !isReply) return;

  try {
    if (isReply) {
      const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
      if (repliedTo.author.id === botId) {
        if (Math.random() > REPLY_CHANCE) return;
        const line = await pickLine('reply');
        await message.reply(line);
        return;
      }
    }

    if (isMentioned) {
      const line = await pickLine('mention');
      await message.reply(line);
      return;
    }
  } catch {
    // silently ignore fetch failures
  }
}
