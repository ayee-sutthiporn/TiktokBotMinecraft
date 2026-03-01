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

        stage('Install Dependencies') {
            steps {
                sh 'npm install'
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

        stage('Start Bot') {
            steps {
                // หยุด process เดิมก่อน (ถ้ามี)
                sh 'pkill -f "node src/index.js" || true'
                // รันแบบ background
                sh 'nohup node src/index.js > bot.log 2>&1 &'
            }
        }
    }

    post {
        success {
            echo '✅ TikTok Minecraft Bot deployed successfully!'
        }
        failure {
            echo '❌ Deployment failed!'
        }
    }
}
