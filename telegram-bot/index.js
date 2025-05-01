import 'dotenv/config';
import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { isValidBin, generateCard } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuración
const BOT_TOKEN = '7916820433:AAF3MB2Aw_sZWif1N4AxLZwRzEGolcRoVzg';
const bot = new Telegraf(BOT_TOKEN);

// Rate limiting and command debouncing
const userStates = new Map();
const COOLDOWN_PERIOD = 2000; // 2 seconds cooldown between commands

const isCommandAllowed = (userId) => {
    const now = Date.now();
    const lastCommandTime = userStates.get(userId);
    
    if (!lastCommandTime || (now - lastCommandTime) >= COOLDOWN_PERIOD) {
        userStates.set(userId, now);
        return true;
    }
    return false;
};

// Middleware para rate limiting
bot.use(async (ctx, next) => {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        const userId = ctx.from.id;
        
        if (!isCommandAllowed(userId)) {
            await ctx.reply('⚠️ Por favor, espera unos segundos antes de usar otro comando.');
            return;
        }
    }
    return next();
});

// Directorio de datos
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Funciones de utilidad
const getUserDataPath = (userId) => path.join(DATA_DIR, `${userId}.json`);

const loadUserData = (userId) => {
    const filePath = getUserDataPath(userId);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    return {
        favorites: [],
        history: []
    };
};

const saveUserData = (userId, data) => {
    const filePath = getUserDataPath(userId);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

// Función para consultar BIN usando APIs alternativas
const lookupBin = async (bin) => {
    try {
        console.log(`Consultando BIN ${bin} en binlist.net...`);
        // Primera API: binlist.net
        const response1 = await fetch(`https://lookup.binlist.net/${bin}`);
        if (response1.ok) {
            const data1 = await response1.json();
            console.log('Respuesta de binlist.net:', data1);
            return {
                bank: data1.bank?.name || 'Desconocido',
                brand: data1.scheme || 'Desconocida',
                type: data1.type || 'Desconocido',
                country: data1.country?.name || 'Desconocido',
                countryCode: data1.country?.alpha2 || '??',
                level: data1.brand || 'Desconocido'
            };
        }
        console.log(`binlist.net falló con status ${response1.status}`);

        console.log(`Consultando BIN ${bin} en bintable.com...`);
        // Segunda API: bintable.com
        const response2 = await fetch(`https://api.bintable.com/v1/${bin}?api_key=19d935a6d3244f3f8bab8f09157e4936`);
        if (response2.ok) {
            const data2 = await response2.json();
            console.log('Respuesta de bintable.com:', data2);
            return {
                bank: data2.bank?.name || 'Desconocido',
                brand: data2.scheme || data2.brand || 'Desconocida',
                type: data2.type || 'Desconocido',
                country: data2.country?.name || 'Desconocido',
                countryCode: data2.country?.code || '??',
                level: data2.level || 'Desconocido'
            };
        }
        console.log(`bintable.com falló con status ${response2.status}`);

        throw new Error('No se pudo obtener información del BIN');
    } catch (error) {
        console.error('Error al consultar BIN:', error);
        return null;
    }
};

// Comandos del bot
bot.command('start', (ctx) => {
    const helpText = `
👋 ¡Bienvenido al Generador de Tarjetas!

Comandos disponibles:

🔧 Generación de Tarjetas:
/gen BIN|MM|YYYY|CVV - Generar 10 tarjetas
Ejemplo: /gen 477349002646|05|2027|123

🔍 Consultas:
/bin BIN - Consultar información de BIN
Ejemplo: /bin 431940

⭐️ Gestión de Favoritos:
/favoritos - Ver BINs guardados
/agregarbin BIN mes? año? cvv? - Guardar BIN
/eliminarbin índice - Eliminar BIN guardado

📋 Otros:
/historial - Ver historial de consultas
/ayuda - Mostrar esta ayuda

Desarrollado por @mat1520
    `;
    ctx.reply(helpText);
});

bot.command('help', (ctx) => {
    ctx.reply('Para ver la lista de comandos, usa /start');
});

bot.command('gen', async (ctx) => {
    const input = ctx.message.text.split(' ')[1];
    if (!input) {
        return ctx.reply('❌ Uso: /gen BIN|MM|YYYY|CVV\nEjemplo: /gen 477349002646|05|2027|123');
    }

    const parts = input.split('|');
    const bin = parts[0];
    const fixedMonth = parts[1];
    const fixedYear = parts[2];
    const fixedCVV = parts[3];

    if (!isValidBin(bin)) {
        return ctx.reply('❌ BIN inválido. Debe contener solo números, entre 6 y 16 dígitos.');
    }

    try {
        const cards = Array(10).fill().map(() => {
            const card = generateCard(bin);
            // Si se proporcionaron valores fijos, los usamos
            if (fixedMonth) card.month = fixedMonth;
            if (fixedYear) card.year = fixedYear?.slice(-2) || card.year;
            if (fixedCVV) card.cvv = fixedCVV;
            return card;
        });
        
        const response = cards.map(card => 
            `${card.number}|${card.month}|${card.year}|${card.cvv}`
        ).join('\n');

        // Guardar en historial
        const userId = ctx.from.id;
        const userData = loadUserData(userId);
        userData.history.unshift({
            type: 'gen',
            bin,
            count: 10,
            timestamp: new Date().toISOString()
        });
        saveUserData(userId, userData);

        ctx.reply(`🎲 Tarjetas generadas:\n\n${response}`);
    } catch (error) {
        ctx.reply(`❌ Error: ${error.message}`);
    }
});

bot.command('bin', async (ctx) => {
    const bin = ctx.message.text.split(' ')[1];
    if (!bin) {
        return ctx.reply('❌ Uso: /bin BIN\nEjemplo: /bin 431940');
    }

    if (!isValidBin(bin)) {
        return ctx.reply('❌ BIN inválido. Debe contener solo números, entre 6 y 16 dígitos.');
    }

    const binInfo = await lookupBin(bin);
    if (!binInfo) {
        return ctx.reply('❌ No se encontró información para este BIN');
    }

    const response = `
🔍 Información del BIN: ${bin}

🏦 Banco: ${binInfo.bank}
💳 Marca: ${binInfo.brand}
🌍 País: ${binInfo.country} (${binInfo.countryCode})
📱 Tipo: ${binInfo.type}
⭐️ Nivel: ${binInfo.level}
    `;

    // Guardar en historial
    const userId = ctx.from.id;
    const userData = loadUserData(userId);
    userData.history.unshift({
        type: 'lookup',
        bin,
        info: binInfo,
        timestamp: new Date().toISOString()
    });
    saveUserData(userId, userData);

    ctx.reply(response);
});

bot.command('favoritos', (ctx) => {
    const userId = ctx.from.id;
    const userData = loadUserData(userId);
    
    if (userData.favorites.length === 0) {
        return ctx.reply('📌 No tienes BINs favoritos guardados');
    }

    const response = userData.favorites.map((fav, index) => 
        `${index + 1}. ${fav.bin} (${fav.month || 'MM'}/${fav.year || 'YY'})`
    ).join('\n');

    ctx.reply(`📌 Tus BINs favoritos:\n\n${response}`);
});

bot.command('agregarbin', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 1) {
        return ctx.reply('❌ Uso: /agregarbin BIN mes? año? cvv?');
    }

    const [bin, month, year, cvv] = args;
    if (!isValidBin(bin)) {
        return ctx.reply('❌ BIN inválido. Debe contener solo números, entre 6 y 16 dígitos.');
    }

    const userId = ctx.from.id;
    const userData = loadUserData(userId);
    
    if (userData.favorites.some(fav => fav.bin === bin)) {
        return ctx.reply('❌ Este BIN ya está en tus favoritos');
    }

    userData.favorites.push({ bin, month, year, cvv });
    saveUserData(userId, userData);

    ctx.reply('✅ BIN agregado a favoritos');
});

bot.command('eliminarbin', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 1) {
        return ctx.reply('❌ Uso: /eliminarbin índice');
    }

    const userId = ctx.from.id;
    const userData = loadUserData(userId);
    
    const index = parseInt(args[0]) - 1;
    if (isNaN(index) || index < 0 || index >= userData.favorites.length) {
        return ctx.reply('❌ Índice inválido');
    }

    const removedBin = userData.favorites.splice(index, 1)[0];
    saveUserData(userId, userData);

    ctx.reply(`✅ BIN ${removedBin.bin} eliminado de favoritos`);
});

bot.command('historial', (ctx) => {
    const userId = ctx.from.id;
    const userData = loadUserData(userId);
    
    if (userData.history.length === 0) {
        return ctx.reply('📝 No hay historial de consultas');
    }

    const response = userData.history.slice(0, 10).map((item, index) => {
        const date = new Date(item.timestamp).toLocaleString();
        if (item.type === 'gen') {
            return `${index + 1}. Generación: ${item.bin} (${item.count} tarjetas) - ${date}`;
        } else {
            return `${index + 1}. Consulta: ${item.bin} - ${date}`;
        }
    }).join('\n');

    ctx.reply(`📝 Historial reciente:\n\n${response}`);
});

// Iniciar el bot
let isShuttingDown = false;

const startBot = async () => {
    try {
        await bot.launch();
        console.log('Bot iniciado');
        
        // Signal ready to PM2
        if (process.send) {
            process.send('ready');
        }
    } catch (err) {
        console.error('Error al iniciar el bot:', err);
        process.exit(1);
    }
};

// Error handling for the bot
bot.catch((err, ctx) => {
    console.error('Error en el manejo del comando:', err);
    if (ctx && !isShuttingDown) {
        ctx.reply('❌ Ocurrió un error al procesar el comando. Por favor, intenta nuevamente.');
    }
});

// Graceful shutdown
const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`Recibida señal ${signal}. Iniciando apagado gracioso...`);
    
    try {
        await bot.stop(signal);
        console.log('Bot detenido correctamente');
    } catch (err) {
        console.error('Error al detener el bot:', err);
    }
    
    process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// Start the bot
startBot();