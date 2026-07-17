import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

export const loadSwagger = (app: INestApplication) => {
  const config = new DocumentBuilder()
    .setTitle('Postmill Swagger file')
    .setDescription('API description')
    .setVersion('1.0')
    // Public API auth (J3): clients authenticate by putting their API key in the
    // `Authorization` header. The same header also accepts an OAuth bearer token,
    // so both schemes are documented for a usable generated client.
    .addApiKey(
      { type: 'apiKey', name: 'Authorization', in: 'header' },
      'api-key'
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'Token' },
      'bearer'
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
};
