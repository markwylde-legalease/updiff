# Use Node.js 22 as the base image
FROM node:22

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install
RUN npx playwright install

# Copy the rest of the application code
COPY . .

# Create necessary directories
RUN mkdir -p public/screenshots

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["npm", "start"]
