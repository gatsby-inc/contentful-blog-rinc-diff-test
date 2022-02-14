const { Spanner } = require("@google-cloud/spanner")
const { diff } = require('jest-diff')
const contentful = require(`contentful-management`)
const pMap = require(`p-map`)
const _ = require(`lodash`)
const fs = require(`fs`)
const path = require(`path`)

const spannerProjectId = `gatsby-project`
const spannerInstance = `gatsby-hosting`
const spannerLocalInstance = `local-instance`
const spannerLocalDatabase = `local-database`
const spannerProdDatabase = `hosting-prod`
const spannerStagingDatabase = `hosting-staging`

const spanner = new Spanner({ projectId: spannerProjectId })
const instance = spanner.instance(spannerInstance)
const localInstance = spanner.instance(spannerLocalInstance)

const stagingDatabase = instance.database(spannerStagingDatabase)
const prodDatabase = instance.database(spannerProdDatabase)
const localDatabase = localInstance.database(spannerLocalDatabase)

const rincLocalDomain = process.env.RINC_DOMAIN
const nonRincLocalDomain = process.env.NON_RINC_DOMAIN
const rincStagingDomain = `contentfulblogrincdifftest.staging-gatsbyjs.io` //01dd2e7a-0a7c-449d-a540-f4d51a92a6cd
const nonRincStagingDomain = `contentfulblogrincdifftestnon.staging-gatsbyjs.io` // 79884ca2-d297-4bd1-9078-10b5d01ed44c
const rincProdDomain = `contentfulblogrincdifftest.gatsbyjs.io` //0bc0fc88-de86-43fd-831e-182dd30cfee2
const nonRincProdDomain = `contentfulblogrincdifftestnon.gatsbyjs.io` // aa3230ac-a142-48de-96ae-0f18f6baeaf2

async function setupSpace() {
  const accessToken = process.env.CONTENTFUL_PERSONAL_TOKEN
  const spaceId = process.env.CONTENTFUL_SPACE_ID

  const client = contentful.createClient({accessToken})
  const space = await client.getSpace(spaceId)
  return space
}

async function createEntry(environment, entryId) {
  const entry = await environment.createEntryWithId(`blogPost`, `${entryId}`, {
    fields: {
      title: {
        "en-US": `Auto generated posts ${entryId}`,
      },
      description: {
        "en-US": `Auto generated posts ${entryId}`,
      },
      publishDate: {
        "en-US": new Date(),
      },
      slug: {
        "en-US": `sup-${entryId}`,
      },
      body: {
        "en-US": `very long text indeed!`,
      },
    },
  })
  await entry.publish()
}

async function addInitialContentfulData(space) {
  console.log(`add 100 blog post entries`)

  const environment = await space.getEnvironment(`master`)
  pMap(
    _.range(100),
    async (entryId) => {
    await createEntry(environment, entryId)
    console.log(`created`, entryId)
    },
    { concurrency: 1 }
  )
}

async function publishChanges(space) {  
  const entryId = _.random(0, 99, false)
  console.log({ entryId })
  const environment = await space.getEnvironment(`master`)

  try {
    let entry = await environment.getEntry(entryId)
    entry.fields.body[`en-US`] = Math.random().toString()
    entry = await entry.update()
    await entry.publish()
  } catch (e) {
    console.log(`error when updating ${entryId}`, e)
    throw e
  }
  console.log(`published update`)

  let toDeleteCreate
  const toDeleteCreatePath = path.join(__dirname, `to-delete-create.json`)
  if (fs.existsSync(toDeleteCreatePath)) {
    toDeleteCreate = JSON.parse(fs.readFileSync(toDeleteCreatePath))
  }

  if (toDeleteCreate) {
    const { deleteId, createId } = toDeleteCreate

    let deleteEntry = await environment.getEntry(deleteId)
    deleteEntry = await deleteEntry.unpublish()
    await deleteEntry.delete()
    console.log(`post deleted`)

    await createEntry(environment, createId)
    fs.writeFileSync(
    toDeleteCreatePath,
    JSON.stringify({ deleteId: createId, createId: deleteId })
    )
    console.log(`post created`)
  } else {
    await createEntry(environment, `100`)
    fs.writeFileSync(
    toDeleteCreatePath,
    JSON.stringify({ deleteId: `100`, createId: `101` })
    )
  }
}

async function queryConfig({
    database,
    domain,
  }) {
    const configQuery = {
      sql: `
        SELECT activeBuildId, activeVersionId, siteInstanceId FROM Configs WHERE domain = @domain`,
      params: {
        domain,
      },
    }

    console.log(`querying for config for ${domain}`)

    const [rows] = await database.run(configQuery)
    return rows[0].toJSON()
}

function filterRoutes(routes, noManifests) {
    if (noManifests) {
        return routes.filter(route => {
            const path = route[0].value
            return !(isWildcardPath(path) && endsWithIndexHtml(path)) && !isPluginPath(path) && !isJsFile(path) && !isNodeManifest(path)
        })
    } else {
        return routes.filter(route => {
            const path = route[0].value
            return !(isWildcardPath(path) && endsWithIndexHtml(path)) && !isPluginPath(path) && !isJsFile(path)
        })
    }  
}

function isWildcardPath(path) {
    // the path it contains /* or /: or includes query params
    return (
      /\/\*/g.test(path) || /\/:/g.test(path) || containsQueryParams(path)
    )
  }

function containsQueryParams(path) {
return /\S+\?\S+/g.test(path)
}

function endsWithIndexHtml(path) {
    return path.endsWith(`.index.html`)
}

function isJsFile(path) {
    return path.endsWith(`.js`) || path.endsWith(`.js.map`) || path.includes(`js.LICENSE.txt`)
}

function isPluginPath(path) {
    const pluginPaths = ["/_functions.json", "/_gatsby-config.json", "/_headers.json", "/_redirects.json"]
    return pluginPaths.includes(path)
}

function isNodeManifest(path) {
    return path.includes(`__node-manifests`)
}

async function queryRoutes({
    database, 
    config,
    isRinc
}) {
    const { activeBuildId, activeVersionId, siteInstanceId } = config
    let query

    if (isRinc) {
        console.log(`querying for RINC routes for version Id ${activeVersionId}`)

        query = {
            sql: `
            SELECT path, functionId, ssrId, ssrType, toPath, ignoreCase, status, headers
            FROM Routes@{FORCE_INDEX=RoutesBySiteInstanceVersionPathIgnoreCase}
            WHERE 
            siteInstanceId = @siteInstanceId
            AND versionId = @activeVersionId
            ORDER BY path
            `,
            params: {
                activeVersionId,
                siteInstanceId
            }
        }
    } else {
        console.log(`querying for non-RINC routes for build Id ${activeBuildId}`)

        query = {
            sql: `
            SELECT path, functionId, ssrId, ssrType, toPath, ignoreCase, status, headers 
            FROM Routes 
            WHERE buildId = @activeBuildId
            ORDER BY path
            `,
            params: {
                activeBuildId
            }
        }
    }

    const [rows] = await database.run(query)
    return rows
}

async function getDiff({ database, rincDomain, nonRincDomain, environment, noManifests=false }) {
    const nonRincPath = path.join(__dirname, `non-rinc.json`)
    const rincPath = path.join(__dirname, `rinc.json`)

    const nonRincConfig = await queryConfig({database, domain: nonRincDomain})
    const rincConfig = await queryConfig({database, domain: rincDomain})

    const nonRincRoutes = await queryRoutes({database, config: nonRincConfig, isRinc: false})
    const rincRoutes = await queryRoutes({database, config: rincConfig, isRinc: true})

    const filteredNonRincRoutes = filterRoutes(nonRincRoutes, noManifests)
    const filteredRincRoutes = filterRoutes(rincRoutes, noManifests)
    
    const options = {
        aAnnotation: `Non RINC`,
        bAnnotation: `RINC`,
        includeChangeCounts: true,
        contextLines: 3,
        expand: false,
      }
    
    const difference = diff(filteredNonRincRoutes, filteredRincRoutes, options)

    console.log(`Showing diff for ${environment} environment`)
    console.log(difference)

    fs.writeFileSync(nonRincPath, JSON.stringify(filteredNonRincRoutes))
    fs.writeFileSync(rincPath, JSON.stringify(filteredRincRoutes))
}

async function main() {
    const command = process.argv[2]
    const option = process.argv[3]

    const space = await setupSpace()
    
    if (command === `setup`) {
        console.log(`Setting up Contenful...`)
        addInitialContentfulData(space)
    }

    if (command == `increment`) {
        console.log(`Updating source data in Contentful...`)
        await publishChanges(space)
    }

    if (command == `diff`) {
        if (option === `local`) {
            // run local with SPANNER_EMULATOR_HOST=localhost:9010
            if (rincLocalDomain && nonRincLocalDomain) {
                getDiff({ 
                    database: localDatabase, 
                    rincDomain: rincLocalDomain, 
                    nonRincDomain: nonRincLocalDomain, 
                    environment: `local`, 
                })
            } else {
                console.log(`provide local domains as env variables`)
            }
        } else {
            getDiff({
                database: stagingDatabase,
                rincDomain: rincStagingDomain,
                nonRincDomain: nonRincStagingDomain, 
                environment: `staging`
            })
        
            getDiff({
                database: prodDatabase, 
                rincDomain: rincProdDomain,
                nonRincDomain: nonRincProdDomain,
                environment: `production`
            })
        }
    } 

    if (command == `diff2`) { //without node manifests 
        if (option === `local`) {
            if (rincLocalDomain && nonRincLocalDomain) {
                // run local with SPANNER_EMULATOR_HOST=localhost:9010
                getDiff({ 
                    database: localDatabase, 
                    rincDomain: rincLocalDomain, 
                    nonRincDomain: nonRincLocalDomain, 
                    environment: `local`,
                    noManifests: true 
                })
            } else {
                console.log(`provide local domains as env variables`)
            }
        } else {
            getDiff({
                database: stagingDatabase,
                rincDomain: rincStagingDomain,
                nonRincDomain: nonRincStagingDomain, 
                environment: `staging`,
                noManifests: true 
            })
        
            getDiff({
                database: prodDatabase, 
                rincDomain: rincProdDomain,
                nonRincDomain: nonRincProdDomain,
                environment: `production`,
                noManifests: true 
            })
        }
    } 
}

main()