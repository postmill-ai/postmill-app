// Declarative Pipeline for building Node.js application and running SonarQube analysis triggered by a push event.
pipeline {
    // Defines the execution environment. Using 'agent any' to ensure an agent is available.
    agent any 

    // Global environment block removed to prevent Groovy scoping issues with manual path calculation.

    stages {
        // Stage 1: Checkout the code (Relies on the initial SCM checkout done by Jenkins)
        stage('Source Checkout') {
            steps {
                echo "Workspace already populated by the initial SCM checkout. Proceeding."
            }
        }

        // Stage 2: Setup Node.js and install pnpm.
        // Versions must track package.json (`engines.node`, `packageManager`) and the
        // native-module deps must match .github/workflows/* — canvas/sharp/bcrypt are
        // compiled during install and `pnpm install` fails without them.
        stage('Setup Environment and Tools') {
            steps {
                sh '''
                    echo "Ensuring required utilities and Node.js are installed..."
                    sudo apt-get update
                    sudo apt-get install -y curl unzip

                    # 1. Install Node.js v22 (package.json requires >=22.12.0 <23.0.0)
                    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
                    sudo apt-get install -y nodejs
                    echo "Node.js version: \$(node -v)"

                    # 2. Native build deps for canvas / sharp / bcrypt
                    sudo apt-get install -y libcairo2-dev libjpeg-dev libpango1.0-dev \\
                        libgif-dev build-essential g++ libpixman-1-dev

                    # 3. Install pnpm globally (must match package.json packageManager)
                    npm install -g pnpm@10.34.4
                    echo "pnpm version: \$(pnpm -v)"
                '''
            }
        }

        // Stage 3: Install dependencies and build the application
        stage('Install and Build') {
            steps {
                sh 'pnpm install'
                sh 'pnpm run build'
            }
        }

        // Stage 4: Run SonarQube analysis: Install scanner, get version, and execute.
        stage('SonarQube Analysis') {
            steps {
                script {
                    // 1. Get the short 8-character commit SHA for project versioning
                    def commitShaShort = sh(returnStdout: true, script: 'git rev-parse --short=8 HEAD').trim()
                    echo "Commit SHA (short) is: ${commitShaShort}"
                    
                    // --- 2. MANUALLY INSTALL THE SONAR SCANNER CLI LOCALLY IN THIS STAGE ---
                    sh """
                        echo "Manually downloading and installing Sonar Scanner CLI..."
                        
                        # Download the stable scanner CLI package
                        curl -sS -o sonar-scanner.zip \
                        "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-7.0.2.4839.zip"
                        
                        # Added -o flag to force overwrite and prevent interactive prompt failure
                        unzip -o -q sonar-scanner.zip -d .
                    """

                    // 3. Find the extracted directory name and capture the full absolute bin path in Groovy
                    // This is defined locally and used directly, avoiding environment variable issues.
                    def scannerBinPath = sh(
                        returnStdout: true,
                        script: '''
                            SCANNER_DIR=$(find . -maxdepth 1 -type d -name "sonar-scanner*" | head -n 1)
                            # Get the full absolute path to the executable file
                            echo \$(pwd)/\${SCANNER_DIR}/bin/sonar-scanner
                        '''
                    ).trim()
                    
                    echo "Scanner executable path captured: ${scannerBinPath}"
                    
                    // 4. Use withSonarQubeEnv to set up the secure variables (HOST and TOKEN)
                    withSonarQubeEnv(installationName: 'SonarQube-Server') {
                        // 5. Execute the scanner using the Groovy variable directly.
                        sh """
                            echo "Starting SonarQube Analysis for project version: ${commitShaShort}"
                            
                            # Execute the full, absolute path captured in the Groovy variable.
                            '${scannerBinPath}' \\
                                -Dsonar.projectVersion=${commitShaShort} \\
                                -Dsonar.sources=.
                                
                            # SONAR_HOST_URL and SONAR_TOKEN are automatically passed as environment variables
                            # by the withSonarQubeEnv block.
                        """
                    }
                }
            }
        }
    }
}
