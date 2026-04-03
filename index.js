import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'node:path';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import logger from './utils/logger.js';
import { notifyDev } from './utils/notify.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = new Collection();
client.cachedUsers = {};

const commandsPath = join(dirname(fileURLToPath(import.meta.url)), 'commands');
const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = join(commandsPath, file);
  try {
    const command = await import(filePath);
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    } else {
      logger.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
  } catch (err) {
    logger.error(`Failed to load command at ${filePath}: ${err.message}`);
  }
}

const eventsPath = join(dirname(fileURLToPath(import.meta.url)), 'events');
const eventFiles = readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = join(eventsPath, file);
  const event = await import(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down...`);
  await notifyDev(client, 'stop');
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(process.env.TOKEN);
