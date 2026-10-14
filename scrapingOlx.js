const { chromium } = require("playwright");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// Palavras que descartam qualquer anúncio, independente do modelo buscado
// (checadas por substring — propositalmente "largas" pra pegar variações).
const JUNK_GERAL = [
  "capinha", "capa", "pelicula", "película", "peça", "peca", "defeito",
  "trincad", "vitrine", "troco", "troca por", "acessório", "acessorio"
];

const buscas = [
  {
    modelo: "iPhone 15 128GB",
    url: "https://www.olx.com.br/celulares/apple/iphone-15/128gb/estado-sc/norte-de-santa-catarina?sp=1",
    obrigatorias: ["15"],
    bloqueadas: ["pro", "max", "plus"]
  },
  {
    modelo: "iPhone 15 256GB",
    url: "https://www.olx.com.br/celulares/apple/iphone-15/256gb/estado-sc/norte-de-santa-catarina?sp=1",
    obrigatorias: ["15"],
    bloqueadas: ["pro", "max", "plus"]
  },
  {
    modelo: "iPhone 15 Pro 128GB",
    url: "https://www.olx.com.br/celulares/128gb/estado-sc/norte-de-santa-catarina?q=iphone%2015%20pro&sp=1",
    obrigatorias: ["15", "pro"],
    bloqueadas: ["max"]
  },
  {
    modelo: "iPhone 15 Pro 256GB",
    url: "https://www.olx.com.br/celulares/256gb/estado-sc/norte-de-santa-catarina?q=iphone%2015%20pro&sp=1",
    obrigatorias: ["15", "pro"],
    bloqueadas: ["max"]
  },
  {
    modelo: "iPhone 15 Pro Max",
    url: "https://www.olx.com.br/celulares/apple/iphone-15-pro-max/estado-sc/norte-de-santa-catarina?sp=1",
    obrigatorias: ["15", "pro", "max"],
    bloqueadas: []
  },
  {
    modelo: "iPhone 16 128GB",
    url: "https://www.olx.com.br/celulares/apple/iphone-16/128gb/estado-sc/norte-de-santa-catarina?sp=1",
    obrigatorias: ["16"],
    // "16e" não bate com a obrigatória "16" (palavra exata), mas deixo
    // explícito aqui também por clareza.
    bloqueadas: ["pro", "max", "plus", "16e"]
  },
  {
    modelo: "iPhone 16 256GB",
    url: "https://www.olx.com.br/celulares/apple/iphone-16/256gb/estado-sc/norte-de-santa-catarina?sp=1",
    obrigatorias: ["16"],
    bloqueadas: ["pro", "max", "plus", "16e"]
  },
  {
    modelo: "iPhone 16 Pro 128GB",
    url: "https://www.olx.com.br/celulares/apple/iphone-16-pro/128gb/estado-sc/norte-de-santa-catarina?sp=1",
    obrigatorias: ["16", "pro"],
    bloqueadas: ["max", "16e"]
  },
  {
    modelo: "iPhone 16 Pro 256GB",
    url: "https://www.olx.com.br/celulares/apple/iphone-16-pro/256gb/estado-sc/norte-de-santa-catarina?sp=1",
    obrigatorias: ["16", "pro"],
    bloqueadas: ["max", "16e"]
  },
  {
    modelo: "iPhone 16 Pro Max",
    url: "https://www.olx.com.br/celulares/apple/iphone-16-pro-max/estado-sc/norte-de-santa-catarina?sp=1",
    obrigatorias: ["16", "pro", "max"],
    bloqueadas: ["16e"]
  },
  {
    modelo: "iPhone 17",
    url: "https://www.olx.com.br/celulares/apple/iphone-17/256gb/estado-sc/norte-de-santa-catarina?q=iphone%2017&sp=1",
    obrigatorias: ["17"],
    bloqueadas: ["pro", "max", "plus", "air"]
  },
  {
    modelo: "iPhone 17 Pro",
    url: "https://www.olx.com.br/celulares/apple/iphone-17-pro/256gb/estado-sc/norte-de-santa-catarina?q=iphone%2017&sp=1",
    obrigatorias: ["17", "pro"],
    bloqueadas: ["max", "air"]
  },
  {
    modelo: "iPhone 17 Pro Max",
    url: "https://www.olx.com.br/celulares/apple/iphone-17-pro-max/256gb/estado-sc/norte-de-santa-catarina?q=iphone%2017&sp=1",
    obrigatorias: ["17", "pro", "max"],
    bloqueadas: ["air"]
  }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MESES_PT = {
  janeiro: 0, jan: 0,
  fevereiro: 1, fev: 1,
  março: 2, marco: 2, mar: 2,
  abril: 3, abr: 3,
  maio: 4, mai: 4,
  junho: 5, jun: 5,
  julho: 6, jul: 6,
  agosto: 7, ago: 7,
  setembro: 8, set: 8,
  outubro: 9, out: 9,
  novembro: 10, nov: 10,
  dezembro: 11, dez: 11
};

// Converte o texto de data da OLX ("Hoje, 14:32", "Ontem, 18:55",
// "9 de outubro", "09/10/2026"...) numa Date real. Retorna null se o
// formato não for reconhecido (ex: só o nome do dia da semana).
function parseDataAnuncio(textoOriginal, agora) {
  if (!textoOriginal) return null;
  const texto = textoOriginal.toLowerCase().trim();

  if (texto.startsWith("hoje")) {
    const horaMatch = texto.match(/(\d{1,2}):(\d{2})/);
    const data = new Date(agora);
    if (horaMatch) data.setHours(Number(horaMatch[1]), Number(horaMatch[2]), 0, 0);
    else data.setHours(0, 0, 0, 0);
    return data;
  }

  if (texto.startsWith("ontem")) {
    const horaMatch = texto.match(/(\d{1,2}):(\d{2})/);
    const data = new Date(agora);
    data.setDate(data.getDate() - 1);
    if (horaMatch) data.setHours(Number(horaMatch[1]), Number(horaMatch[2]), 0, 0);
    else data.setHours(0, 0, 0, 0);
    return data;
  }

  let match = texto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, dia, mes, ano] = match;
    return new Date(Number(ano), Number(mes) - 1, Number(dia));
  }

  match = texto.match(/(\d{1,2})\s+de\s+([a-zç]+)(?:\s+de\s+(\d{4}))?/);
  if (match) {
    const [, dia, mesTexto, anoTexto] = match;
    const mesIndex = MESES_PT[mesTexto];
    if (mesIndex === undefined) return null;
    const ano = anoTexto ? Number(anoTexto) : agora.getFullYear();
    const data = new Date(ano, mesIndex, Number(dia));
    // Sem ano explícito e data "no futuro" -> provavelmente é do ano anterior.
    if (!anoTexto && data > agora) data.setFullYear(data.getFullYear() - 1);
    return data;
  }

  return null;
}

// Separa os anúncios em: dentro do limite de dias, mais antigos que o
// limite, e com data em formato não reconhecido (fica de fora da lista
// principal por segurança, mas disponível pra inspeção).
function filtrarPorData(anuncios, agora, limiteDias = 30) {
  const limiteMs = limiteDias * 24 * 60 * 60 * 1000;
  const validos = [];
  const antigos = [];
  const dataNaoReconhecida = [];

  for (const anuncio of anuncios) {
    const dataPublicacao = parseDataAnuncio(anuncio.data, agora);

    if (!dataPublicacao) {
      dataNaoReconhecida.push(anuncio);
      continue;
    }

    if (agora - dataPublicacao > limiteMs) {
      antigos.push(anuncio);
    } else {
      validos.push(anuncio);
    }
  }

  return { validos, antigos, dataNaoReconhecida };
}

// Verifica se "termo" aparece como palavra inteira em "titulo" (não como
// parte de outra palavra/número). É isso que evita "16" bater em "16e",
// ou "pro" bater em "aprovado".
function contemPalavra(titulo, termo) {
  const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|[^a-z0-9])${escapado}([^a-z0-9]|$)`, "i");
  return regex.test(titulo);
}

function tituloValido(tituloOriginal, obrigatorias, bloqueadas) {
  const titulo = tituloOriginal.toLowerCase();

  const temJunkGeral = JUNK_GERAL.some(palavra => titulo.includes(palavra));
  if (temJunkGeral) return false;

  const temTodasObrigatorias = obrigatorias.every(palavra => contemPalavra(titulo, palavra));
  const temAlgumaBloqueada = bloqueadas.some(palavra => contemPalavra(titulo, palavra));
  return temTodasObrigatorias && !temAlgumaBloqueada;
}

function extrairIdDoLink(href) {
  const match = href?.match(/-(\d+)$/);
  return match ? match[1] : null;
}

function precoParaNumero(precoTexto) {
  const limpo = precoTexto
    .replace("R$", "")
    .trim()
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const numero = parseFloat(limpo);
  return isNaN(numero) ? null : numero;
}

function mediana(valores) {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 !== 0
    ? ordenados[meio]
    : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

// Q1 e Q3 pelo método da mediana das metades (exclui o valor central
// quando a quantidade de itens é ímpar).
function calcularQuartis(valoresOrdenados) {
  const n = valoresOrdenados.length;
  const meio = Math.floor(n / 2);
  const metadeInferior = valoresOrdenados.slice(0, meio);
  const metadeSuperior = n % 2 === 0 ? valoresOrdenados.slice(meio) : valoresOrdenados.slice(meio + 1);
  return { q1: mediana(metadeInferior), q3: mediana(metadeSuperior) };
}

// Remove anúncios com preço muito fora da curva (regra do IQR, padrão
// estatístico: fora de [Q1 - 1.5*IQR, Q3 + 1.5*IQR]). Com menos de 4
// anúncios não dá pra calcular isso com confiança, então não filtra.
function removerDiscrepantes(anuncios) {
  if (anuncios.length < 4) {
    return { validos: anuncios, descartados: [] };
  }

  const precosOrdenados = anuncios.map(a => a.preco).sort((a, b) => a - b);
  const { q1, q3 } = calcularQuartis(precosOrdenados);
  const iqr = q3 - q1;
  const limiteInferior = q1 - 1.5 * iqr;
  const limiteSuperior = q3 + 1.5 * iqr;

  const validos = [];
  const descartados = [];

  for (const anuncio of anuncios) {
    if (anuncio.preco < limiteInferior || anuncio.preco > limiteSuperior) {
      descartados.push(anuncio);
    } else {
      validos.push(anuncio);
    }
  }

  return { validos, descartados };
}

async function buscarAnuncios(page, busca) {
  await page.goto(busca.url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Espera os cards aparecerem. Se não aparecerem, provavelmente caiu num
  // desafio/bloqueio — tira print pra você inspecionar o que rolou.
  try {
    await page.waitForSelector("section.olx-adcard", { timeout: 15000 });
  } catch {
    const printPath = path.join(__dirname, `bloqueio_${Date.now()}.png`);
    await page.screenshot({ path: printPath, fullPage: true });
    console.log(`   ⚠️  Cards não apareceram. Print salvo em: ${printPath}`);
    return [];
  }

  const html = await page.content();
  const $ = cheerio.load(html);
  const anuncios = [];

  $("section.olx-adcard").each((_, el) => {
    const card = $(el);
    const link = card.find('a[data-testid="adcard-link"]');
    const href = link.attr("href");
    const titulo = link.attr("title")?.trim();
    const precoTexto = card.find("h3.olx-adcard__price").text().trim();

    if (!titulo || !href || !precoTexto) return;
    if (!tituloValido(titulo, busca.obrigatorias, busca.bloqueadas)) return;

    const preco = precoParaNumero(precoTexto);
    if (preco === null) return;

    anuncios.push({
      id: extrairIdDoLink(href),
      titulo,
      link: href,
      preco,
      localizacao: card.find("p.olx-adcard__location").text().trim(),
      data: card.find("p.olx-adcard__date").text().trim(),
      imagem: card.find("picture img").attr("src") || null
    });
  });

  return anuncios;
}

(async () => {
  const browser = await chromium.launch({
    headless: false, // navegador visível: mais parecido com uso real
    slowMo: 100
  });

  const context = await browser.newContext({
    locale: "pt-BR",
    viewport: { width: 1366, height: 768 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  try {
    const resultados = [];
    const agora = new Date();

    for (const busca of buscas) {
      console.log(`🔎 Buscando: ${busca.modelo}`);
      const anunciosBrutos = await buscarAnuncios(page, busca);

      const { validos: anunciosRecentes, antigos, dataNaoReconhecida } = filtrarPorData(anunciosBrutos, agora, 30);
      const { validos: anuncios, descartados: discrepantes } = removerDiscrepantes(anunciosRecentes);
      const precos = anuncios.map(a => a.preco);

      resultados.push({
        modelo: busca.modelo,
        url: busca.url,
        totalAnuncios: anuncios.length,
        precoMinimo: precos.length ? Math.min(...precos) : null,
        precoMediano: mediana(precos),
        precoMaximo: precos.length ? Math.max(...precos) : null,
        anuncios,
        anunciosDescartadosPorPreco: discrepantes,
        anunciosMaisAntigosQue30Dias: antigos,
        anunciosDataNaoReconhecida: dataNaoReconhecida
      });

      console.log(`   ${anuncios.length} anúncio(s) válido(s) encontrado(s)`);
      if (antigos.length) {
        console.log(`   🕓 ${antigos.length} anúncio(s) descartado(s) por ter mais de 30 dias`);
      }
      if (dataNaoReconhecida.length) {
        console.log(`   ⚠️  ${dataNaoReconhecida.length} anúncio(s) com data em formato não reconhecido`);
      }
      if (discrepantes.length) {
        console.log(`   ⚠️  ${discrepantes.length} anúncio(s) descartado(s) por preço discrepante`);
      }
      await sleep(4000 + Math.random() * 3000); // 4-7s, intervalo variável entre buscas
    }

    const jsonFinal = {
      atualizadoEm: new Date().toISOString(),
      totalBuscas: resultados.length,
      resultados
    };

    fs.writeFileSync(
      path.join(__dirname, "precos_olx.json"),
      JSON.stringify(jsonFinal, null, 2)
    );

    console.log("✅ precos_olx.json atualizado");
  } catch (erro) {
    console.error("❌ Erro no scraping:", erro.message);
  } finally {
    await browser.close();
  }
})();
