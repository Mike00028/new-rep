# Voice Assistant - Docker Deployment

## 🚀 Quick Start

### Prerequisites
- Docker Desktop installed (with WSL2 on Windows)
- Ollama running on host machine (port 11434)
- 16GB+ RAM recommended

### 1. Build and Start All Services
```bash
# Build Docker images
manage.bat build

# Start all services
manage.bat start
```

### 2. Access the Application
- **Frontend**: http://localhost:3000
- **STT API**: http://localhost:5200/docs
- **TTS API**: http://localhost:5100
- **LLM API**: http://localhost:11435/docs

---

## 📊 Scaling Services

### Scale STT Server (for high transcription load)
```bash
# Scale to 3 instances
manage.bat scale stt-server=3

# Scale back to 1 instance
manage.bat scale stt-server=1
```

### Scale LLM Server (for multiple concurrent chats)
```bash
manage.bat scale llm-server=2
```

### Check Current Status
```bash
manage.bat status
```

---

## 🔧 Management Commands

| Command | Description |
|---------|-------------|
| `manage.bat start` | Start all services |
| `manage.bat stop` | Stop all services |
| `manage.bat restart` | Restart all services |
| `manage.bat scale [service]=[count]` | Scale a specific service |
| `manage.bat logs` | View logs for all services |
| `manage.bat logs [service]` | View logs for specific service |
| `manage.bat status` | Check health status |
| `manage.bat build` | Rebuild Docker images |

---

## 📈 Auto-Scaling Strategy

### For 30 Users/Day

**Normal Load (1-5 concurrent users):**
```bash
manage.bat start  # Default: 1 instance each
```

**High Load (5-10 concurrent users):**
```bash
manage.bat scale stt-server=2
manage.bat scale llm-server=2
```

**Peak Load (10-15 concurrent users):**
```bash
manage.bat scale stt-server=3
manage.bat scale llm-server=3
manage.bat scale tts-server=2
```

### Idle Shutdown (1 hour no traffic)
```bash
# Manually stop services
manage.bat stop

# Or use Windows Task Scheduler to run:
# manage.bat stop
# after 1 hour of inactivity
```

---

## 🔍 Monitoring

### View Real-time Logs
```bash
# All services
manage.bat logs

# Specific service
manage.bat logs stt-server
```

### Check Resource Usage
```bash
docker stats
```

### Check Health Status
```bash
manage.bat status
```

---

## 🗃️ Data Persistence

### Conversation History
- Stored in: `./llm-server/conversations.db` (SQLite)
- Persisted across container restarts
- Backed up automatically to host machine

### Session Files
- Stored in: `./llm-server/conversations/` folder
- Volume-mounted from host

---

## 🐛 Troubleshooting

### Services won't start
```bash
# Check logs
manage.bat logs

# Rebuild images
manage.bat build
manage.bat start
```

### Can't connect to Ollama
Make sure Ollama is running on host:
```bash
# Check Ollama status
curl http://localhost:11434/api/tags
```

### Out of memory
Reduce resource limits in `docker-compose.yml`:
```yaml
deploy:
  resources:
    limits:
      memory: 2G  # Reduce this
```

### Reset everything
```bash
# Stop and remove everything
docker-compose down -v

# Rebuild from scratch
manage.bat build
manage.bat start
```

---

## 📦 Resource Requirements

### Minimum (1 instance each)
- CPU: 4 cores
- RAM: 8GB
- Disk: 20GB

### Recommended (scaled up)
- CPU: 8 cores
- RAM: 16GB
- Disk: 50GB

### Per Service Resource Usage
| Service | CPU | RAM | Instances for 30 users |
|---------|-----|-----|----------------------|
| STT | 1-2 cores | 2-4GB | 1-2 |
| TTS | 0.5-1 core | 1-2GB | 1 |
| LLM | 1-2 cores | 2-4GB | 1-2 |
| Frontend | 0.5 core | 512MB | 1 |

---

## 🔐 Security Notes

- Services communicate on internal Docker network
- Only frontend exposed to local network
- No authentication in current setup (add for production)
- Conversation data stored locally only

---

## 🚀 Production Deployment

For production deployment:
1. Add nginx reverse proxy
2. Enable HTTPS/SSL
3. Add authentication (JWT tokens)
4. Use external database (PostgreSQL)
5. Add monitoring (Prometheus + Grafana)
6. Set up automatic backups

---

## 📝 Notes

- First startup takes 5-10 minutes (image building)
- Ollama must run on host (not containerized due to GPU access)
- Scaling is manual - use `manage.bat scale` when load increases
- Health checks run every 30 seconds
- Containers auto-restart on failure
