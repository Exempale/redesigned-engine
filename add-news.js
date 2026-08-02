// import-news.js - Run with: node import-news.js news.txt

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const mainDbPath = path.join(__dirname, 'api', 'main.db');
const db = new sqlite3.Database(mainDbPath);

// Get filename from command line or use default
const filename = process.argv[2] || 'news.txt';

if (!fs.existsSync(filename)) {
    console.error(`❌ Файл "${filename}" не найден.`);
    console.log('Использование: node import-news.js [filename.txt]');
    process.exit(1);
}

const content = fs.readFileSync(filename, 'utf8');
const entries = content.split(/---\s*\n/);

let count = 0;
let errors = 0;

entries.forEach(entry => {
    const trimmed = entry.trim();
    if (!trimmed) return;
    
    // Match Title:"..." and Contents:"..."
    const titleMatch = trimmed.match(/Title:\s*"([^"]*)"/);
    const contentsMatch = trimmed.match(/Contents:\s*"([^"]*)"(?!\s*Title:)/);
    
    if (!titleMatch || !contentsMatch) {
        console.error('❌ Неверный формат записи:');
        console.log(trimmed.substring(0, 100) + '...\n');
        errors++;
        return;
    }
    
    const title = titleMatch[1].trim();
    const contents = contentsMatch[1].trim();
    
    if (title && contents) {
        db.run(`
            INSERT INTO mascot_news (title, content)
            VALUES (?, ?)
        `, [title, contents], function(err) {
            if (err) {
                console.error('❌ Ошибка:', err.message);
                errors++;
            } else {
                count++;
                console.log(`✅ Добавлена новость: "${title}"`);
            }
        });
    }
});

setTimeout(() => {
    console.log(`\n📊 Готово! Добавлено: ${count}, Ошибок: ${errors}`);
    db.close();
}, 500);