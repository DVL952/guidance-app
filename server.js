const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialisation Supabase et OpenAI
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PORT = process.env.PORT || 3000;

// Route pour la consultation "Flash IA" (5 crédits)
app.post('/api/consultation-flash', async (req, res) => {
    const { utilisateur_id, texte_question, prenom_tiers } = req.body;

    if (!utilisateur_id || !texte_question) {
        return res.status(400).json({ error: "L'identifiant utilisateur et la question sont requis." });
    }

    try {
        // 1. Récupérer l'utilisateur pour vérifier son solde de crédits
        const { data: utilisateur, error: userError } = await supabase
            .from('utilisateurs')
            .select('*')
            .eq('id', utilisateur_id)
            .single();

        if (userError || !utilisateur) {
            return res.status(404).json({ error: "Utilisateur non trouvé." });
        }

        if (utilisateur.credits_balance < 5) {
            return res.status(403).json({ error: "Crédits insuffisants. 5 crédits requis pour une réponse Flash IA." });
        }

        // 2. Préparer le prompt pour l'IA
        const promptSysteme = `Tu es une conseillère spirituelle et voyante empathique, bienveillante et intuitive. 
Ton objectif est de fournir une guidance constructive et éclairée, sans prédire de fatalité irrémédiable et en respectant l'éthique (pas de diagnostic médical ni de conseils juridiques).
Prends en compte les informations de l'utilisateur : 
Prénom : ${utilisateur.prenom}, Date de naissance : ${utilisateur.date_naissance}, Lieu : ${utilisateur.lieu_naissance}.
${prenom_tiers ? `Une tierce personne est concernée : ${prenom_tiers}.` : ''}`;

        // 3. Appel de l'API OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: promptSysteme },
                { role: "user", content: texte_question }
            ],
            max_tokens: 500,
            temperature: 0.7,
        });

        const texteReponse = completion.choices[0].message.content;

        // 4. Déduire les 5 crédits de l'utilisateur
        const nouveauSolde = utilisateur.credits_balance - 5;
        await supabase
            .from('utilisateurs')
            .update({ credits_balance: nouveauSolde })
            .eq('id', utilisateur_id);

        // Enregistrer la transaction de crédit
        await supabase
            .from('transactions_credits')
            .insert({
                utilisateur_id: utilisateur_id,
                type_mouvement: 'CONSOMMATION',
                montant_credits: -5
            });

        // 5. Enregistrer la consultation dans la base
        const { data: consultation, error: consultError } = await supabase
            .from('consultations')
            .insert({
                utilisateur_id: utilisateur_id,
                type_consultation: 'SIMPLE',
                niveau_risque: 'VERT',
                texte_question: texte_question,
                prenom_tiers: prenom_tiers || null,
                texte_reponse: texteReponse
            })
            .select()
            .single();

        if (consultError) throw consultError;

        // 6. Renvoyer la réponse à l'application mobile
        res.json({
            success: true,
            message: "Consultation Flash IA effectuée avec succès.",
            solde_credits: nouveauSolde,
            reponse: texteReponse,
            consultation_id: consultation.id
        });

    } catch (err) {
        console.error("Erreur consultation Flash IA:", err);
        res.status(500).json({ error: "Une erreur est survenue lors du traitement de votre demande." });
    }
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});