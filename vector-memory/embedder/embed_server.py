from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

app = FastAPI()
model = SentenceTransformer("all-MiniLM-L6-v2")

class EmbedRequest(BaseModel):
    texts: list[str]

@app.post("/embed")
def embed_texts(req: EmbedRequest):
    embeddings = model.encode(req.texts, convert_to_tensor=False).tolist()
    return {"embeddings": embeddings}

@app.get("/health")
def health_check():
    return {"status": "ok"}
