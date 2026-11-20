// globalSetup do Vitest para integração/e2e: sobe o ElasticMQ uma vez por execução.
import type { TestProject } from 'vitest/node';
import { startTestElasticMq } from './elasticmq';

import './provided-context';

export default async function setup(project: TestProject) {
  const sqs = await startTestElasticMq();
  project.provide('sqsEndpoint', sqs.endpoint);
  return async () => {
    await sqs.stop();
  };
}
