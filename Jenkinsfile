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
                bat 'npm install'
            }
        }

        stage('Setup Environment') {
            steps {
                // ใช้ Jenkins Credentials เพื่อสร้างไฟล์ .env
                withCredentials([
                    string(credentialsId: 'EULERSTREAM_API_KEY', variable: 'EULERSTREAM_API_KEY'),
                    string(credentialsId: 'RCON_HOST', variable: 'RCON_HOST'),
                    string(credentialsId: 'RCON_PORT', variable: 'RCON_PORT'),
                    string(credentialsId: 'RCON_PASSWORD', variable: 'RCON_PASSWORD')
                ]) {
                    bat """
                        (
                            echo EULERSTREAM_API_KEY=%EULERSTREAM_API_KEY%
                            echo RCON_HOST=%RCON_HOST%
                            echo RCON_PORT=%RCON_PORT%
                            echo RCON_PASSWORD=%RCON_PASSWORD%
                            echo QUEUE_CONCURRENCY=1
                            echo GLOBAL_COOLDOWN_MS=50
                            echo RECONNECT_DELAY_MS=5000
                        ) > .env
                    """
                }
            }
        }

        stage('Start Bot') {
            steps {
                // หยุด process เดิมก่อน (ถ้ามี)
                bat 'taskkill /F /FI "WINDOWTITLE eq TikTokBot" || exit 0'
                // รันแบบ background
                bat 'start "TikTokBot" /B node src/index.js'
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
