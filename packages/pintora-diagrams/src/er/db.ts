import { StyleParam } from '../util/style'

export enum Cardinality {
  ZERO_OR_ONE = 'ZERO_OR_ONE',
  ZERO_OR_MORE = 'ZERO_OR_MORE',
  ONE_OR_MORE = 'ONE_OR_MORE',
  ONLY_ONE = 'ONLY_ONE',
  MORE = 'MORE',
}

export enum Identification {
  NON_IDENTIFYING = 'NON_IDENTIFYING',
  IDENTIFYING = 'IDENTIFYING',
}

export type Attribute = {
  attributeType: string
  attributeName: string
  attributeKey?: string
}

export type Entity = {
  attributes: Attribute[]
}

export type Relationship = {
  entityA: string
  roleA: string
  entityB: string
  relSpec: RelSpec
}

export type RelSpec = {
  cardA: Cardinality
  cardB: Cardinality
  relType: Identification
}

export type ErDiagramIR = {
  entities: Record<string, Entity>
  relationships: Relationship[]
  styleParams: StyleParam[]
}

class ErDb {
  Cardinality = Cardinality
  Identification = Identification

  entities: Record<string, Entity> = {}
  relationships: Relationship[] = []
  styleParams: ErDiagramIR['styleParams'] = []

  addEntity(name: string) {
    if (!this.entities[name]) {
      this.entities[name] = { attributes: [] }
    }
    return this.entities[name]
  }
  addRelationship(entityA: string, roleA: string, entityB: string, relSpec: RelSpec) {
    const rel: Relationship = {
      entityA,
      roleA,
      entityB,
      relSpec,
    }

    this.relationships.push(rel)
  }
  getDiagramIR(): ErDiagramIR {
    return {
      entities: this.entities,
      relationships: this.relationships,
      styleParams: this.styleParams,
    }
  }
  addAttributes(name: string, attributes: Attribute[]) {
    const entity = this.addEntity(name)
    entity.attributes.push(...attributes)
  }
  addStyle(styleParam: StyleParam) {
    this.styleParams.push(styleParam)
  }
  clear() {
    this.entities = {}
    this.relationships = []
    this.styleParams = []
  }
}

const db = new ErDb()

export default db
