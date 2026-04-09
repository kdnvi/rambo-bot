import { REST, Routes } from 'discord.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'node:path';
import logger from './utils/logger.js';

const commands = [];
const commandsPath = join(dirname(fileURLToPath(import.meta.url)), 'commands');
const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = join(commandsPath, file);
  try {
    const command = await import(filePath);
    if ('data' in command && 'execute' in command) {
      commands.push(command.data.toJSON());
    } else {
      logger.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
  } catch (err) {
    logger.error(`Failed to load command at ${filePath}: ${err.message}`);
  }
}

for (const key of ['TOKEN', 'APP_ID', 'GUILD_ID']) {
  if (!process.env[key]) {
    logger.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const rest = new REST().setToken(process.env.TOKEN);

try {
  logger.info(`Started refreshing ${commands.length} application (/) commands.`);

  const data = await rest.put(
    Routes.applicationGuildCommands(process.env.APP_ID, process.env.GUILD_ID),
    { body: commands },
  );

  logger.info(`Successfully reloaded ${data.length} application (/) commands.`);
} catch (error) {
  logger.error(error);
  process.exit(1);
}
