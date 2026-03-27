import axios from 'axios';

export const analyzeIncident = async (incidentNumber, question, folderPath) => {
  const url = 'http://127.0.0.1:5000/analyze_incident';
  const payload = {
    incident_number: incidentNumber,
    question: question,
    folder_path: folderPath,
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error while calling analyzeIncident API:', error);
    throw error;
  }
};

// PHASE3/4 Prompt Catalog API helpers
const BASE = 'http://127.0.0.1:5000';

export const listPrompts = async (persona = null, activeOnly = false) => {
  const params = new URLSearchParams();
  if (persona) params.append('persona', persona);
  if (activeOnly) params.append('active', 'true');
  const url = `${BASE}/prompts?${params.toString()}`;
  try {
    const res = await axios.get(url);
    return res.data;
  } catch (e) {
    console.error('listPrompts failed', e);
    throw e;
  }
};

export const suggestPrompt = async (question, persona = null) => {
  try {
    const res = await axios.post(`${BASE}/prompts/suggest`, { question, persona });
    return res.data;
  } catch (e) {
    console.error('suggestPrompt failed', e);
    throw e;
  }
};

export const promptEvents = async (type = null, limit = 50) => {
  const params = new URLSearchParams();
  if (type) params.append('type', type);
  if (limit) params.append('limit', limit);
  try {
    const res = await axios.get(`${BASE}/prompts/events?${params.toString()}`);
    return res.data;
  } catch (e) {
    console.error('promptEvents failed', e);
    throw e;
  }
};

export const promptHealth = async () => {
  try {
    const res = await axios.get(`${BASE}/prompts/health`);
    return res.data;
  } catch (e) {
    console.error('promptHealth failed', e);
    throw e;
  }
};

export const upsertPrompt = async (entry) => {
  try {
    const res = await axios.post(`${BASE}/prompts/upsert`, entry);
    return res.data;
  } catch (e) {
    console.error('upsertPrompt failed', e);
    throw e;
  }
};

export const togglePrompt = async (id, enabled) => {
  try {
    const res = await axios.patch(`${BASE}/prompts/${id}/enable`, { enabled });
    return res.data;
  } catch (e) {
    console.error('togglePrompt failed', e);
    throw e;
  }
};