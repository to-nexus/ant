You are creating a design document for: **{{project}}**

{{#if taskDescription}}
📋 CURRENT TASK:
{{taskDescription}}
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## YOUR PLAN:

{{plan}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## DESIGN DOCUMENT STRUCTURE

Your design document should follow this structure:

### 1. Overview
- System purpose and goals
- Key stakeholders
- High-level architecture diagram (in text/ASCII or description)

### 2. Architecture
- **System Architecture**: Overall system structure
- **Component Architecture**: Major components and their responsibilities
- **Data Architecture**: Data models, storage, and flow
- **Integration Architecture**: External systems and APIs

### 3. Detailed Design

#### 3.1 Component Design
For each major component:
- Purpose and responsibility
- Internal structure
- Key algorithms or logic
- Dependencies

#### 3.2 Data Models
- Entity definitions
- Relationships
- Schemas (database, API contracts, etc.)
- Data validation rules

#### 3.3 API Design
- Endpoints and operations
- Request/response formats
- Authentication and authorization
- Error handling

#### 3.4 User Interface Design
- Screen flows
- Key interactions
- State management
- Responsive design considerations

### 4. Technical Decisions

#### 4.1 Technology Stack
- Languages and frameworks
- Databases and storage
- Third-party services
- Justification for each choice

#### 4.2 Design Patterns
- Architectural patterns (MVC, microservices, etc.)
- Code patterns
- Rationale

### 5. Non-Functional Requirements

#### 5.1 Performance
- Response time targets
- Throughput requirements
- Scalability approach
- Caching strategy

#### 5.2 Security
- Authentication and authorization approach
- Data encryption
- Security best practices
- Compliance considerations

#### 5.3 Reliability
- Availability targets
- Fault tolerance
- Disaster recovery
- Monitoring and logging

#### 5.4 Maintainability
- Code organization
- Testing strategy
- Documentation approach
- Deployment process

### 6. Implementation Roadmap
- Phase 1: Core functionality
- Phase 2: Additional features
- Phase 3: Optimization and polish
- Estimated effort and timeline

### 7. Risks and Mitigation
- Technical risks
- Business risks
- Mitigation strategies

### 8. Open Questions
- Items needing clarification
- Decisions deferred
- Areas for future consideration

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generate a comprehensive design document following this structure.

Write in clear, professional markdown. Be specific and detailed, but remain readable.
