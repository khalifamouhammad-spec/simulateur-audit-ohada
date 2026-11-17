// Client minimal de l'API Groq (compatible OpenAI). La clé vient des paramètres (localStorage).
import { URL_GROQ } from './config.js';

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function appeler(chemin, cle, options = {}) {
  if (!cle) throw new Error("Aucune clé API Groq : saisissez-la dans l'écran Paramètres.");
  let reponse;
  try {
    reponse = await fetch(URL_GROQ + chemin, {
      ...options,
      headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    });
  } catch {
    throw new Error("Impossible de joindre l'API Groq (vérifiez la connexion internet).");
  }
  if (!reponse.ok) {
    let detail = '';
    try { detail = (await reponse.json()).error?.message || ''; } catch { /* corps non JSON */ }
    const erreur = new Error(
      reponse.status === 401 ? 'Clé API Groq refusée : vérifiez-la dans les Paramètres.'
        : reponse.status === 429 ? `Limite d'utilisation Groq atteinte. ${detail}`
        : `Erreur Groq ${reponse.status}. ${detail}`
    );
    erreur.statut = reponse.status;
    erreur.attente = Number(reponse.headers.get('retry-after')) || 0;
    throw erreur;
  }
  return reponse.json();
}

/** Liste des modèles accessibles avec la clé (sert aussi de test de connexion). */
export async function listerModeles(cle) {
  const r = await appeler('/models', cle);
  return (r.data || []).map((m) => m.id).sort();
}

/** Appelle le modèle et renvoie l'objet JSON de sa réponse. */
export async function demanderJSON({ cle, modele, systeme, utilisateur, temperature = 0.8, maxTokens = 8000 }) {
  const corps = JSON.stringify({
    model: modele,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: systeme }, { role: 'user', content: utilisateur }],
  });
  let r;
  try {
    r = await appeler('/chat/completions', cle, { method: 'POST', body: corps });
  } catch (e) {
    // Limite par minute : une seule nouvelle tentative après le délai indiqué.
    if (e.statut !== 429 || e.attente <= 0 || e.attente > 60) throw e;
    await attendre((e.attente + 1) * 1000);
    r = await appeler('/chat/completions', cle, { method: 'POST', body: corps });
  }
  const texte = r.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(texte);
  } catch {
    const debut = texte.indexOf('{');
    const fin = texte.lastIndexOf('}');
    if (debut >= 0 && fin > debut) {
      try { return JSON.parse(texte.slice(debut, fin + 1)); } catch { /* ci-dessous */ }
    }
    throw new Error("La réponse de l'IA n'est pas un JSON valide (réponse probablement tronquée).");
  }
}
