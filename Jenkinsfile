pipeline {
    agent any

    environment {
        NODE_ENV = 'production'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Setup Environment') {
            steps {
                withCredentials([
                    string(credentialsId: 'EULERSTREAM_API_KEY', variable: 'EULERSTREAM_API_KEY'),
                    string(credentialsId: 'RCON_HOST', variable: 'RCON_HOST'),
                    string(credentialsId: 'RCON_PORT', variable: 'RCON_PORT'),
                    string(credentialsId: 'RCON_PASSWORD', variable: 'RCON_PASSWORD')
                ]) {
                    sh '''
                        cat > .env << EOF
EULERSTREAM_API_KEY=${EULERSTREAM_API_KEY}
RCON_HOST=${RCON_HOST}
RCON_PORT=${RCON_PORT}
RCON_PASSWORD=${RCON_PASSWORD}
QUEUE_CONCURRENCY=1
GLOBAL_COOLDOWN_MS=50
RECONNECT_DELAY_MS=5000
EOF
                    '''
                }
            }
        }

        stage('Ensure Data Files') {
            steps {
                sh '''
                    [ -f sessions.json ] || echo "[]" > sessions.json
                    [ -f seen_gifts.json ] || echo "{}" > seen_gifts.json
                    mkdir -p public/uploads
                '''
            }
        }

        stage('Build & Deploy') {
            steps {
                sh 'docker compose down || true'
                sh 'docker compose build --no-cache'
                sh 'docker compose up -d'
            }
        }

        stage('Health Check') {
            steps {
                sh '''
                    sleep 5
                    curl -f http://localhost/api/sessions || exit 1
                '''
            }
        }
    }

    post {
        success {
            echo '✅ TikTok Minecraft Bot deployed successfully!'
        }
        failure {
            echo '❌ Deployment failed!'
            sh 'docker compose logs --tail=50 || true'
        }
    }
}
