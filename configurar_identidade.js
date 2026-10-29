// Execute dentro da pasta do projeto: node configurar_identidade.js
const fs = require('fs');
const file = 'app.json';
if (!fs.existsSync(file)) { console.error('app.json não encontrado. Execute na pasta do projeto.'); process.exit(1); }
const original = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!original.expo || !original.expo.android || !original.expo.android.package) { console.error('Configuração Android não encontrada; nenhuma alteração feita.'); process.exit(1); }
fs.copyFileSync(file, 'app.json.antes-mybank.bak');
const expo = original.expo;
expo.name = 'MY BANK';
expo.icon = './assets/Iconelol.png';
expo.android.adaptiveIcon = { ...(expo.android.adaptiveIcon || {}), foregroundImage: './assets/Iconelol.png', backgroundColor: '#0A141D' };
expo.splash = { ...(expo.splash || {}), image: './assets/Mybanklol.png', resizeMode: 'contain', backgroundColor: '#0A141D' };
expo.plugins = (expo.plugins || []).map(p => {
  if (Array.isArray(p) && p[0] === 'expo-splash-screen') return ['expo-splash-screen', { ...(p[1] || {}), image: './assets/Mybanklol.png', imageWidth: 240, resizeMode: 'contain', backgroundColor: '#0A141D' }];
  return p;
});
fs.writeFileSync(file, JSON.stringify(original, null, 2) + '\n');
console.log('Identidade MY BANK aplicada. Package e projectId preservados.');
